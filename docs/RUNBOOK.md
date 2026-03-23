# Runbook — AI Financial Planner POC

---

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Node.js | 18+ | Required |
| npm | 9+ | Required |
| LLM provider | One of: Groq / Gemini / OpenAI / Ollama | See LLM setup below |
| Redis | Optional | Falls back to in-memory Map |
| ChromaDB | Optional | Falls back to keyword search |

---

## Installation

```bash
cd /path/to/AgenticAI

# Backend dependencies (includes langchain, langgraph, multer, etc.)
cd backend && npm install

# Frontend dependencies
cd ../frontend && npm install
```

---

## Configuration (`backend/.env`)

### LLM Provider (choose one)

```env
# Option A: Groq — FREE, fast 70B model (recommended)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# Option B: Google Gemini — FREE tier (1500 req/day)
# GEMINI_API_KEY=AIza...
# GEMINI_MODEL=gemini-2.0-flash

# Option C: OpenAI — Paid, highest quality
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini

# Option D: Ollama — Local, no internet needed
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2
```

Priority chain: `GROQ_API_KEY` → `GEMINI_API_KEY` → `OPENAI_API_KEY` → Ollama fallback.

### Embedding Model (independent of chat LLM)

```env
# Recommended: dedicated Ollama embedding model (free)
OLLAMA_EMBEDDING_MODEL=nomic-embed-text   # ollama pull nomic-embed-text

# Alternative: OpenAI embeddings (paid)
# OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Alternative: Gemini embeddings (free)
# GEMINI_EMBEDDING_MODEL=text-embedding-004
```

### Optional services

```env
# Redis (falls back to in-memory if not set)
REDIS_HOST=localhost
REDIS_PORT=6379
SESSION_TTL_SECONDS=3600

# ChromaDB (falls back to keyword search if not set)
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=financial_memory
TOP_K_RESULTS=5

# LangSmith observability (optional)
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=financial-planner-poc
```

**Minimum required**: one LLM API key (or Ollama running). Everything else has a graceful fallback.

---

## Starting Services

### Minimum (Groq or OpenAI, no Docker)

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm start
```

### Full stack (with Redis + ChromaDB)

```bash
# Docker services
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 8000:8000 chromadb/chroma

# Application
cd backend && npm run dev
cd frontend && npm start
```

### Local LLM (Ollama)

```bash
ollama serve
ollama pull llama3.2
ollama pull nomic-embed-text    # dedicated embedding model

# In .env: comment out all API keys, set OLLAMA_MODEL=llama3.2
cd backend && npm run dev
```

---

## API Reference

### POST `/api/chat`

Conversational financial planning endpoint. Runs the full hybrid pipeline.

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Can I retire at 55?", "sessionId": "optional-uuid"}'
```

Response:
```json
{
  "sessionId": "uuid",
  "message": "Based on your projected $4.3M in savings...",
  "ui": [
    { "type": "profile_summary" },
    { "type": "simulation_chart" },
    { "type": "explanation_panel" }
  ],
  "data": {
    "profile":    { "age": 35, "income": 80000, ... },
    "simulation": { "projected_savings_at_retirement": 4347122, "can_retire_at_target": true, ... },
    "portfolio":  null,
    "risk":       null
  },
  "meta": {
    "intent": "Retirement feasibility check",
    "confidence": "high",
    "decision_rationale": "Included simulation because user asked about retirement timeline.",
    "missing_data": ["tax_document"]
  },
  "trace": [
    { "agent": "planner",    "latencyMs": 1200 },
    { "agent": "profile",    "latencyMs": 900 },
    { "agent": "simulation", "latencyMs": 5200 },
    { "agent": "explanation","latencyMs": 2100 }
  ]
}
```

---

### POST `/api/upload`

Multi-modal document upload. Trust-by-design: raw content never stored.

```bash
# Upload tax document
curl -X POST http://localhost:3000/api/upload \
  -F "document=@backend/data/sample-tax-document.txt" \
  -F "sessionId=your-session-id"

# Upload bank statement
curl -X POST http://localhost:3000/api/upload \
  -F "document=@backend/data/sample-bank-statement.txt" \
  -F "sessionId=your-session-id"
```

Response:
```json
{
  "sessionId": "uuid",
  "message": "Tax document analyzed. Here's what I found...",
  "documentType": "tax_document",
  "confidence": "high",
  "ui": [
    { "type": "profile_summary" },
    { "type": "tax_panel" },
    { "type": "simulation_chart" },
    { "type": "explanation_panel" }
  ],
  "data": { "profile": {...}, "tax": {...}, "simulation": {...} },
  "ingestion": {
    "document_type": "tax_document",
    "abstracted_signals": {
      "income_range": "UPPER_MIDDLE",
      "primary_insight": "Upper-middle income bracket with moderate deductions"
    },
    "pii_stored": false,
    "raw_document_stored": false
  }
}
```

---

### GET `/api/session/:id`

Retrieve full session state.

```bash
curl http://localhost:3000/api/session/abc-123
```

---

### GET `/api/health`

Check service availability.

```bash
curl http://localhost:3000/api/health
```

```json
{
  "services": {
    "groq":     { "status": "connected",  "model": "llama-3.3-70b-versatile" },
    "redis":    { "status": "fallback",   "detail": "in-memory fallback" },
    "chromadb": { "status": "fallback",   "detail": "keyword search fallback" }
  }
}
```

---

## Sample Files

| File | Purpose |
|------|---------|
| `backend/data/sample-tax-document.txt` | Fictional W-2 / 1040 summary (tax agent demo) |
| `backend/data/sample-bank-statement.txt` | Fictional bank statement (cashflow agent demo) |

Files contain clearly labeled fictional data. Raw values in the files are processed ephemerally and discarded — only abstracted signals persist.

---

## Demo Flow

1. **Start**: `"Can I retire at 55?"` → profile_summary + simulation_chart appear
2. **Ask**: `"What should I invest in?"` → portfolio_view + risk_dashboard appear
3. **Upload** `sample-tax-document.txt` → tax_panel appears, simulation updates
4. **Upload** `sample-bank-statement.txt` → cashflow_panel appears
5. **Ask**: `"What should I improve to retire at 50?"` → personalized answer using all context
6. **Show**: `trace[]` in response (agent latencies), session `.md` file (abstracted signals only)

**Key trust talking point**: Open `backend/data/sessions/<sessionId>.md`.
You'll see `income_range: UPPER_MIDDLE` — not `$145,000`. No SSNs. No account numbers.

---

## Verifying the Architecture

### Confirm numbers come from math, not LLM

Look for this in logs:
```
[Agent]    SimulationAgent [1/2] deterministic projection
[Agent]      Projected savings: $4,347,122
```
Then verify manually: `FV = 200000 × (1.07)^30 + 34000 × ((1.07)^30 - 1)/0.07`

The number in the log should match the formula — not vary per run.

### Confirm ReactiveEngine fires

```bash
# Look for in logs after any profile save:
[ReactiveEngine] PROFILE_UPDATED → cascade=[simulation, portfolio, risk]
[ReactiveEngine] ✔ simulation recomputed (2ms)
```

The 2ms time confirms deterministic math (not an LLM call, which takes seconds).

---

## Resetting State

```bash
# Clear session markdown files
rm backend/data/sessions/*.md

# Clear Redis (if running)
redis-cli FLUSHALL

# Clear ChromaDB (if running)
docker restart <chromadb-container-id>
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Startup error: `savings_gap is not defined` | Template bug in prompts.js — use `{savings_gap}` not `${savings_gap}` |
| `Cannot find module '@langchain/groq'` | `cd backend && npm install --legacy-peer-deps` |
| LLM not responding | Check API key in `.env`; for Ollama, run `ollama serve` |
| Upload returns 400 | Field name must be `document`; file must be `.txt`, `.json`, or `.csv` |
| Simulation returns $0 | Profile data missing — check profile agent ran and returned non-null |
| ReactiveEngine not cascading | Check `services.js` exports `reactiveEngine`; check routes call `reactiveEngine.seedFromSession()` |
| Angular compile error | `cd frontend && npm install` |
| Port 3000 in use | `lsof -ti:3000 \| xargs kill` |
