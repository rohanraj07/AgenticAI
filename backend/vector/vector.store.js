import { ChromaClient } from 'chromadb';
import { embeddings } from '../langchain/llm.js';
import { log } from '../logger.js';

const COLLECTION = process.env.CHROMA_COLLECTION || 'financial_memory';
const TOP_K = Number(process.env.TOP_K_RESULTS) || 5;

/**
 * VectorStore — ChromaDB-backed semantic memory.
 * Falls back to in-memory keyword search when ChromaDB is unavailable.
 */
export class VectorStore {
  constructor() {
    this.client = new ChromaClient({ path: process.env.CHROMA_URL || 'http://localhost:8000' });
    this.collection = null;
    this._useChroma = false;
    this._fallbackDocs = [];
  }

  async init() {
    try {
      this.collection = await this.client.getOrCreateCollection({ name: COLLECTION });
      this._useChroma = true;
      log.vector('ChromaDB connected — collection:', COLLECTION);
    } catch {
      this._useChroma = false;
      log.warn('ChromaDB unavailable — using in-memory keyword fallback (no semantic search)');
      log.warn('  To start ChromaDB: docker run -p 8000:8000 chromadb/chroma');
    }
  }

  async add(id, text, metadata = {}) {
    log.vector('ADD doc', id, `(${text.length} chars)`, JSON.stringify(metadata));
    if (this._useChroma) {
      try {
        log.vector('  → embedding document...');
        const [vector] = await embeddings.embedDocuments([text]);
        log.vector('  → embedding done, dims:', vector.length);
        await this.collection.add({ ids: [id], embeddings: [vector], documents: [text], metadatas: [metadata] });
        log.vector('  → stored in ChromaDB');
        return;
      } catch (err) {
        log.warn('ChromaDB add failed, falling back to memory:', err.message);
      }
    }
    this._fallbackDocs.push({ id, text, metadata });
    if (this._fallbackDocs.length > 200) this._fallbackDocs = this._fallbackDocs.slice(-200);
    log.vector('  → stored in fallback (total:', this._fallbackDocs.length, 'docs)');
  }

  async search(query) {
    log.vector('SEARCH query:', query.slice(0, 80) + (query.length > 80 ? '...' : ''));
    if (this._useChroma) {
      try {
        const [queryVector] = await embeddings.embedDocuments([query]);
        const results = await this.collection.query({ queryEmbeddings: [queryVector], nResults: TOP_K });
        const docs = results?.documents?.[0]?.filter(Boolean) || [];
        log.vector(`  → ChromaDB returned ${docs.length} results`);
        docs.forEach((d, i) => log.vector(`  [${i+1}] ${d.slice(0, 100)}...`));
        return docs;
      } catch (err) {
        log.warn('ChromaDB search failed, falling back:', err.message);
      }
    }
    const q = query.toLowerCase();
    const results = this._fallbackDocs.filter((d) => d.text.toLowerCase().includes(q)).slice(-TOP_K).map((d) => d.text);
    log.vector(`  → fallback keyword search: ${results.length} results`);
    return results;
  }

  async searchAsContext(query) {
    const docs = await this.search(query);
    const ctx = docs.join('\n\n---\n\n');
    log.vector('searchAsContext → context length:', ctx.length, 'chars');
    return ctx;
  }

  async storeSessionSnapshot(sessionId, markdownContent) {
    const id = `session:${sessionId}:${Date.now()}`;
    log.vector('storeSessionSnapshot', sessionId, `(${markdownContent.length} chars)`);
    await this.add(id, markdownContent, { sessionId, type: 'session_snapshot' });
  }
}
