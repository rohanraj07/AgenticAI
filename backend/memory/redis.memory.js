import Redis from 'ioredis';
import { log } from '../logger.js';
import { SchemaValidator } from './schema.validator.js';

const _validator = new SchemaValidator();

/**
 * RedisMemory — structured JSON session store.
 * Falls back to an in-memory Map when Redis is unavailable.
 */
export class RedisMemory {
  constructor() {
    this._fallback = new Map();
    this._useRedis = false;
    this.ttl = Number(process.env.SESSION_TTL_SECONDS) || 3600;

    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });

    this.client.on('error', () => {});
  }

  async connect() {
    try {
      await this.client.connect();
      this._useRedis = true;
      log.redis('Connected to Redis at', process.env.REDIS_HOST || 'localhost', ':', process.env.REDIS_PORT || 6379);
    } catch (err) {
      this._useRedis = false;
      log.warn('Redis unavailable — using in-memory session store (data will NOT persist across restarts)');
      log.warn('  To start Redis: docker run -d -p 6379:6379 redis:7-alpine');
    }
  }

  async _get(key) {
    if (this._useRedis) {
      const raw = await this.client.get(key).catch(() => null);
      const val = raw ? JSON.parse(raw) : null;
      log.redis('GET', key, '→', val ? `found (${JSON.stringify(val).length} bytes)` : 'miss');
      return val;
    }
    const val = this._fallback.get(key) ?? null;
    log.redis('[fallback] GET', key, '→', val ? 'found' : 'miss');
    return val;
  }

  async _set(key, value) {
    if (this._useRedis) {
      await this.client.setex(key, this.ttl, JSON.stringify(value)).catch(() => {});
      log.redis('SET', key, `(TTL ${this.ttl}s, ${JSON.stringify(value).length} bytes)`);
    } else {
      this._fallback.set(key, value);
      log.redis('[fallback] SET', key);
    }
  }

  async _del(key) {
    if (this._useRedis) {
      await this.client.del(key).catch(() => {});
      log.redis('DEL', key);
    } else {
      this._fallback.delete(key);
      log.redis('[fallback] DEL', key);
    }
  }

  async saveSession(sessionId, data) {
    await this._set(`session:${sessionId}`, data);
  }

  async getSession(sessionId) {
    return this._get(`session:${sessionId}`);
  }

  async updateSession(sessionId, partial) {
    // ── Schema enforcement — block forbidden PII fields before any write ──
    _validator.validateSessionWrite(partial);

    const existing = (await this.getSession(sessionId)) || {};

    // ── Optimistic locking — version check-and-set ────────────────────────
    // If the caller passes _expectedVersion and it does not match the stored
    // version, the write is a stale update — reject it to prevent overwrites.
    if (partial._expectedVersion !== undefined) {
      const storedVersion = existing._version ?? 0;
      if (storedVersion !== partial._expectedVersion) {
        log.warn(
          `[RedisMemory] optimistic lock conflict session=${sessionId} ` +
          `expected=${partial._expectedVersion} got=${storedVersion} — write rejected`,
        );
        throw new OptimisticLockError(sessionId, partial._expectedVersion, storedVersion);
      }
    }
    // Strip the sentinel field — never store it
    const { _expectedVersion: _, ...safePatch } = partial;

    const merged = {
      ...existing,
      ...safePatch,
      _version:   (existing._version ?? 0) + 1,
      updatedAt:  new Date().toISOString(),
    };
    await this.saveSession(sessionId, merged);
    log.redis('updateSession', sessionId, `→ merged keys: [${Object.keys(safePatch).join(', ')}] version=${merged._version}`);
    return merged;
  }

  async appendMessage(sessionId, role, content) {
    const session = (await this.getSession(sessionId)) || { messages: [] };
    session.messages = session.messages || [];
    session.messages.push({ role, content, ts: new Date().toISOString() });
    if (session.messages.length > 50) session.messages = session.messages.slice(-50);
    await this.saveSession(sessionId, session);
    log.redis('appendMessage', sessionId, `role=${role}`, `total=${session.messages.length} msgs`);
  }

  async getConversationString(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session?.messages?.length) return '';
    const text = session.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    log.redis('getConversationString', sessionId, `→ ${session.messages.length} messages`);
    return text;
  }

  async deleteSession(sessionId) {
    await this._del(`session:${sessionId}`);
  }
}

// ── OptimisticLockError ───────────────────────────────────────────────────────

/**
 * Thrown when a versioned write is rejected due to a concurrent modification.
 */
export class OptimisticLockError extends Error {
  constructor(sessionId, expected, actual) {
    super(
      `Optimistic lock conflict for session=${sessionId}: ` +
      `expected _version=${expected}, stored _version=${actual}`,
    );
    this.name     = 'OptimisticLockError';
    this.sessionId = sessionId;
    this.expected  = expected;
    this.actual    = actual;
  }
}
