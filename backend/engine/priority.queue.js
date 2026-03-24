/**
 * PriorityQueue — priority-based event queue with deduplication (coalescing).
 *
 * Events are bucketed into three priority levels:
 *   HIGH   (1) — PROFILE_UPDATED
 *   MEDIUM (2) — TAX_UPDATED, CASHFLOW_UPDATED, PORTFOLIO_UPDATED, SIMULATION_UPDATED
 *   LOW    (3) — EXPLANATION_READY, AGENT_STARTED, AGENT_COMPLETED
 *
 * Within the same priority level events are FIFO (insertion order preserved).
 *
 * Deduplication: if an entry with the same (event, sessionId) is already
 * pending, the new payload is merged into the existing entry and its
 * updatedAt timestamp is refreshed — no duplicate is added.
 */

// ── Priority constants ────────────────────────────────────────────────────────

/** @enum {number} */
export const PRIORITY = {
  HIGH:   1,
  MEDIUM: 2,
  LOW:    3,
};

/**
 * Maps each event name to its numeric priority level.
 * @type {Record<string, number>}
 */
export const EVENT_PRIORITY = {
  PROFILE_UPDATED:    1,  // HIGH
  TAX_UPDATED:        2,  // MEDIUM
  CASHFLOW_UPDATED:   2,  // MEDIUM
  PORTFOLIO_UPDATED:  2,  // MEDIUM
  SIMULATION_UPDATED: 2,  // MEDIUM
  EXPLANATION_READY:  3,  // LOW
  AGENT_STARTED:      3,  // LOW
  AGENT_COMPLETED:    3,  // LOW
};

// ── PriorityQueue ─────────────────────────────────────────────────────────────

export class PriorityQueue {
  constructor() {
    /**
     * Ordered list of pending entries (not yet sorted).
     * @type {Array<{event: string, sessionId: string, payload: object, priority: number, insertedAt: number, updatedAt: number}>}
     */
    this._queue = [];

    /**
     * Deduplication index: `${event}:${sessionId}` → entry reference.
     * @type {Map<string, object>}
     */
    this._map = new Map();
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Add an event to the queue.
   *
   * If an entry with the same (event, sessionId) already exists the new payload
   * is shallow-merged into the existing entry and its updatedAt is refreshed.
   * No duplicate entry is inserted.
   *
   * @param {string} event      Event name (e.g. 'PROFILE_UPDATED')
   * @param {string} sessionId  Session identifier
   * @param {object} payload    Event payload to store / merge
   * @param {number} [priority] Numeric priority (1=HIGH … 3=LOW). Defaults to
   *                            EVENT_PRIORITY[event] ?? PRIORITY.MEDIUM
   */
  enqueue(event, sessionId, payload, priority) {
    const resolvedPriority = priority ?? EVENT_PRIORITY[event] ?? PRIORITY.MEDIUM;
    const key = `${event}:${sessionId}`;

    if (this._map.has(key)) {
      // Coalesce — merge payload into existing entry
      const existing = this._map.get(key);
      existing.payload   = { ...existing.payload, ...payload };
      existing.updatedAt = Date.now();
      return;
    }

    const entry = {
      event,
      sessionId,
      payload,
      priority:   resolvedPriority,
      insertedAt: Date.now(),
      updatedAt:  Date.now(),
    };

    this._map.set(key, entry);
    this._queue.push(entry);
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  /**
   * Return the next item that would be served (lowest priority number, then
   * earliest insertedAt) WITHOUT removing it from the queue.
   *
   * @returns {object|undefined}
   */
  peek() {
    if (this._queue.length === 0) return undefined;
    return [...this._queue].sort(
      (a, b) => a.priority - b.priority || a.insertedAt - b.insertedAt,
    )[0];
  }

  /**
   * Return ALL pending items sorted by priority then insertion order, and
   * clear the queue.
   *
   * @returns {Array<{event: string, sessionId: string, payload: object, priority: number, insertedAt: number, updatedAt: number}>}
   */
  drain() {
    const items = [...this._queue].sort(
      (a, b) => a.priority - b.priority || a.insertedAt - b.insertedAt,
    );
    this._queue = [];
    this._map   = new Map();
    return items;
  }

  // ── Introspection ───────────────────────────────────────────────────────────

  /**
   * Number of pending items in the queue.
   * @type {number}
   */
  get size() {
    return this._queue.length;
  }

  /**
   * True when the queue has no pending items.
   * @type {boolean}
   */
  get isEmpty() {
    return this._queue.length === 0;
  }
}
