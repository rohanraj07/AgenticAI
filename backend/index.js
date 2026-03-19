import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { chatRoute } from './routes/chat.route.js';
import { uploadRoute } from './routes/upload.route.js';
import { setupWebSocket } from './routes/ws.route.js';
import { redisMemory, vectorStore } from './services.js';

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
