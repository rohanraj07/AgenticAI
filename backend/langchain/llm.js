import { log } from '../logger.js';

/**
 * LLM provider selection — auto-detects based on environment variables.
 *
 * Priority:
 *   1. OPENAI_API_KEY is set  → OpenAI (gpt-4o-mini or OPENAI_MODEL)
 *   2. Otherwise              → Ollama (local llama3.2 or OLLAMA_MODEL)
 *
 * On a work laptop without Ollama: set OPENAI_API_KEY in .env and the system
 * will automatically use OpenAI. No other code changes needed.
 */

let llm;
let embeddings;

if (process.env.OPENAI_API_KEY) {
  // ── OpenAI path ──────────────────────────────────────────────────────────
  const { ChatOpenAI, OpenAIEmbeddings } = await import('@langchain/openai');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  log.info(`LLM provider: OpenAI (${model})`);

  llm = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    temperature: 0.3,
  });

  embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  });
} else {
  // ── Ollama path (local, no API key needed) ───────────────────────────────
  const { Ollama, OllamaEmbeddings } = await import('@langchain/ollama');

  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  log.info(`LLM provider: Ollama (${model} @ ${baseUrl})`);
  log.info('  Tip: set OPENAI_API_KEY in .env to switch to OpenAI instead');

  llm = new Ollama({ baseUrl, model, temperature: 0.3 });
  embeddings = new OllamaEmbeddings({ baseUrl, model });
}

export { llm, embeddings };
