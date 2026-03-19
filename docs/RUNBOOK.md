# Runbook — AI Financial Planner POC

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Node.js | 18+ | Required |
| npm | 9+ | Required |
| OpenAI API key OR Ollama | Either | See LLM setup below |
| Redis | Optional | Falls back to in-memory |
| ChromaDB | Optional | Falls back to keyword search |

---

## Installation

```bash
# Clone / navigate to project
cd /path/to/AgenticAI

# Install backend dependencies (includes multer, langchain, etc.)
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

---

## Configuration (`backend/.env`)

```env
# ── LLM: Option A — OpenAI (work laptop, recommended)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# ── LLM: Option B — Ollama (local, free)
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2

# ── Optional services (all have graceful fallbacks)
REDIS_HOST=localhost
REDIS_PORT=6379
CHROMA_URL=http://localhost:8000
```

**Minimum required:** `OPENAI_API_KEY` (or Ollama running). Everything else is optional.

---

## Starting Services

### Bare minimum (OpenAI, no Docker)
```bash
# Terminal 1
cd backend && npm start

# Terminal 2
cd frontend && npm start
```

### Full stack (with Redis + ChromaDB)
```bash
# Docker services
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 8000:8000 chromadb/chroma

# Then start app
cd backend && npm start
cd frontend && npm start
```

### Local LLM (Ollama)
```bash
ollama serve
ollama pull llama3.2

# Comment out OPENAI_API_KEY in .env, uncomment OLLAMA_* lines
cd backend && npm start
```

---

## API Reference

### POST `/api/chat`
Conversational financial planning endpoint.

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Can I retire at 55?", "sessionId": "optional-uuid"}'
```

Response:
```json
{
  "sessionId": "uuid",
  "message": "Based on your profile...",
  "ui": [{"type": "simulation_chart"}, {"type": "explanation_panel"}],
  "data": { "profile": {...}, "simulation": {...} },
  "trace": [{"agent": "planner", "latencyMs": 1200}]
}
```

---

### POST `/api/upload`
Multi-modal document upload — trust-by-design (raw content never stored).

```bash
# Upload sample tax document
curl -X POST http://localhost:3000/api/upload \
  -F "document=@backend/data/sample-tax-document.txt" \
  -F "sessionId=your-session-id"

# Upload sample bank statement
curl -X POST http://localhost:3000/api/upload \
  -F "document=@backend/data/sample-bank-statement.txt" \
  -F "sessionId=your-session-id"
```

Response:
```json
{
  "sessionId": "uuid",
  "message": "Tax document analyzed...",
  "documentType": "tax_document",
  "confidence": "high",
  "ui": [{"type": "tax_panel"}, {"type": "simulation_chart"}],
  "data": { "tax": {...}, "simulation": {...} },
  "ingestion": {
    "document_type": "tax_document",
    "abstracted_signals": {
      "income_range": "HIGH",
      "primary_insight": "Married couple in upper-middle income bracket"
    },
    "pii_stored": false,
    "raw_document_stored": false
  }
}
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
    "ollama":   {"status": "unavailable", "detail": "not reachable"},
    "redis":    {"status": "fallback",    "detail": "in-memory fallback"},
    "chromadb": {"status": "fallback",    "detail": "in-memory fallback"}
  }
}
```

---

## Sample Files

Both demo files are pre-built and ready to use:

| File | Purpose |
|------|---------|
| `backend/data/sample-tax-document.txt` | Fictional 1040 summary (tax agent demo) |
| `backend/data/sample-bank-statement.txt` | Fictional bank statement (cashflow agent demo) |

These files contain clearly labeled fictional data and include notes explaining that raw data is never stored.

---

## Demo Flow (Hackathon Script)

1. **Start**: `"Can I retire at 55?"` → shows base simulation
2. **Upload** `sample-tax-document.txt` → tax panel appears, projections update
3. **Upload** `sample-bank-statement.txt` → cashflow panel appears
4. **Ask**: `"What should I improve?"` → personalized recommendations using all context
5. **Show**: Trace panel (agent execution times), session `.md` file (abstracted signals only)

**Key trust talking point:** Open the session `.md` file — no SSNs, no account numbers, no exact dollar amounts. Only: `income_range: HIGH`, `tax_bracket: 32%`, `spending_level: MODERATE`.

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
