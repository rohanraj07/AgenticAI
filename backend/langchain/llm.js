import { log } from '../logger.js';

/**
 * LLM + Embedding provider selection.
 *
 * Chat LLM priority (first matching env var wins):
 *   1. GROQ_API_KEY    → Groq   (free, fast 70B model — recommended)
 *   2. GEMINI_API_KEY  → Google Gemini (free tier, 1500 req/day)
 *   3. OPENAI_API_KEY  → OpenAI (paid, highest quality)
 *   4. fallback        → Ollama (free, fully local)
 *
 * Embedding model (resolved independently of chat LLM):
 *   1. OPENAI_EMBEDDING_MODEL   set → OpenAI embeddings
 *   2. GEMINI_EMBEDDING_MODEL   set → Gemini embeddings
 *   3. OLLAMA_EMBEDDING_MODEL   set → Ollama dedicated embedding model (default: nomic-embed-text)
 *   4. fallback                 → Ollama using same model as chat LLM
 *
 * Keeping them separate means you can mix providers:
 *   e.g. Groq for chat (fast, free) + nomic-embed-text via Ollama (free, dedicated).
 */

// ── Chat LLM ──────────────────────────────────────────────────────────────────

let llm;

if (process.env.GROQ_API_KEY) {
  const { ChatGroq } = await import('@langchain/groq');
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  log.info(`Chat LLM: Groq (${model})`);
  llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model,
    temperature: 0.3,
  });

} else if (process.env.GEMINI_API_KEY) {
  const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  log.info(`Chat LLM: Google Gemini (${model})`);
  llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model,
    temperature: 0.3,
  });

} else if (process.env.OPENAI_API_KEY) {
  const { ChatOpenAI } = await import('@langchain/openai');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  log.info(`Chat LLM: OpenAI (${model})`);
  llm = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    temperature: 0.3,
  });

} else {
  const { Ollama } = await import('@langchain/ollama');
  const model   = process.env.OLLAMA_MODEL    || 'llama3.2';
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  log.info(`Chat LLM: Ollama (${model} @ ${baseUrl})`);
  log.info('  Tip: set GROQ_API_KEY in .env for a free, much faster 70B model');
  llm = new Ollama({ baseUrl, model, temperature: 0.3 });
}

// ── Embedding Model ────────────────────────────────────────────────────────────

let embeddings;

if (process.env.OPENAI_EMBEDDING_MODEL) {
  const { OpenAIEmbeddings } = await import('@langchain/openai');
  const model = process.env.OPENAI_EMBEDDING_MODEL;
  log.info(`Embeddings: OpenAI (${model})`);
  embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model,
  });

} else if (process.env.GEMINI_EMBEDDING_MODEL) {
  const { GoogleGenerativeAIEmbeddings } = await import('@langchain/google-genai');
  const model = process.env.GEMINI_EMBEDDING_MODEL;
  log.info(`Embeddings: Google Gemini (${model})`);
  embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY,
    model,
  });

} else {
  // Ollama — use dedicated OLLAMA_EMBEDDING_MODEL if set, otherwise fall back to chat model
  const { OllamaEmbeddings } = await import('@langchain/ollama');
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model   = process.env.OLLAMA_EMBEDDING_MODEL || process.env.OLLAMA_MODEL || 'llama3.2';
  log.info(`Embeddings: Ollama (${model} @ ${baseUrl})`);
  if (!process.env.OLLAMA_EMBEDDING_MODEL) {
    log.warn('  OLLAMA_EMBEDDING_MODEL not set — using chat model for embeddings (suboptimal)');
    log.warn('  Run: ollama pull nomic-embed-text  then set OLLAMA_EMBEDDING_MODEL=nomic-embed-text');
  }
  embeddings = new OllamaEmbeddings({ baseUrl, model });
}

export { llm, embeddings };
