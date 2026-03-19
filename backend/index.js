import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { chatRoute } from './routes/chat.route.js';
import { uploadRoute } from './routes/upload.route.js';
import { setupWebSocket } from './routes/ws.route.js';
import { redisMemory, vectorStore } from './services.js';
import { log } from './logger.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Detailed service health — used by the frontend status indicator
app.get('/api/health', async (_req, res) => {
  // Check Ollama
  let ollamaStatus = 'unavailable';
  let ollamaDetail = '';
  try {
    const resp = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const data = await resp.json();
      const models = (data.models || []).map((m) => m.name).join(', ');
      ollamaStatus = 'ok';
      ollamaDetail = models || 'running';
    }
  } catch {
    ollamaStatus = 'unavailable';
    ollamaDetail = 'not reachable — run: ollama serve';
  }

  res.json({
    status: 'ok',
    services: {
      ollama:   { status: ollamaStatus, detail: ollamaDetail },
      redis:    { status: redisMemory._useRedis  ? 'ok' : 'fallback', detail: redisMemory._useRedis  ? 'connected' : 'in-memory fallback' },
      chromadb: { status: vectorStore._useChroma ? 'ok' : 'fallback', detail: vectorStore._useChroma ? 'connected' : 'in-memory fallback' },
    },
  });
});

app.use('/api', chatRoute);
app.use('/api', uploadRoute);

// ── Session reset — DELETE /api/session/:sessionId ────────────────────────────
// Clears Redis key + markdown file for a single session.
// Used by the frontend "Reset Session" button for demo purposes.
app.delete('/api/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  log.route(`DELETE /api/session/${sessionId} — resetting session`);

  // 1. Delete from Redis / in-memory store
  await redisMemory.deleteSession(sessionId).catch(() => {});

  // 2. Delete markdown file
  const mdPath = join(process.cwd(), 'data', 'sessions', `${sessionId}.md`);
  if (existsSync(mdPath)) { unlinkSync(mdPath); log.route(`  Deleted markdown: ${mdPath}`); }

  // 3. Reset vector store fallback docs for this session (best-effort)
  if (!vectorStore._useChroma) {
    vectorStore._fallbackDocs = vectorStore._fallbackDocs.filter(
      (d) => d.metadata?.sessionId !== sessionId
    );
    log.route(`  Cleared fallback vector docs for session`);
  }

  log.route(`  Session ${sessionId} fully reset`);
  res.json({ ok: true, sessionId, message: 'Session cleared — Redis, markdown, and vector store entries removed.' });
});

// ── Full demo reset — DELETE /api/reset/all ──────────────────────────────────
// Clears ALL session markdown files + in-memory vector store. For demo purposes only.
app.delete('/api/reset/all', async (_req, res) => {
  log.route('DELETE /api/reset/all — full demo reset');

  // Clear all markdown files
  const sessionDir = join(process.cwd(), 'data', 'sessions');
  let deleted = 0;
  try {
    readdirSync(sessionDir)
      .filter((f) => f.endsWith('.md'))
      .forEach((f) => { unlinkSync(join(sessionDir, f)); deleted++; });
  } catch { /* dir may not exist */ }

  // Clear in-memory vector store
  vectorStore._fallbackDocs = [];

  // Clear in-memory Redis fallback
  if (!redisMemory._useRedis) redisMemory._fallback.clear();

  log.route(`  Full reset: deleted ${deleted} markdown files, cleared in-memory stores`);
  res.json({ ok: true, message: `Full reset complete — ${deleted} session files cleared.` });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
setupWebSocket(wss);

async function bootstrap() {
  // Both services are now gracefully degrading — failures are warnings, not crashes.
  await redisMemory.connect();
  await vectorStore.init();

  httpServer.listen(PORT, () => {
    console.log(`[Server] HTTP + WebSocket listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Unexpected error:', err);
  process.exit(1);
});
