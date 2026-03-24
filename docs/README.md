# AI Financial Planner — POC

> **Architecture**: State-driven deterministic system with an AI interface.
> Numbers from math. Text from LLMs. Control flow from code.

| Layer | Technology |
|-------|------------|
| LLM Orchestration | LangChain.js |
| Agent Flow | LangGraph StateGraph |
| Reactive Engine | Custom event-driven cascade (zero LLM) |
| Compute Modules | Pure JS math (compound interest, glide path, risk scoring) |
| Backend | Node.js + Express + WebSocket |
| Frontend | Angular 17 (standalone components) |
| Session State | Redis (falls back to in-memory Map) |
| Semantic Memory | ChromaDB (falls back to keyword search) |
| Human-readable Memory | Markdown files |
| LLM Providers | Groq (free) · Gemini (free) · OpenAI · Ollama (local) |

---

## Quick Start

### 1. Prerequisites

```bash
node --version   # 18+

# Option A: Groq (free, recommended — sign up at console.groq.com)
echo "GROQ_API_KEY=gsk_..." >> backend/.env

# Option B: Ollama (local, no key needed)
brew install ollama
ollama pull llama3.2
ollama pull nomic-embed-text   # dedicated embedding model

# Optional: Redis + ChromaDB (both have graceful fallbacks)
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 8000:8000 chromadb/chroma
```

### 2. Backend

```bash
cd backend
npm install
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm start
# Opens at http://localhost:4200
```

---

## Architecture in One Diagram

```
User Message
    │
    ▼
Planner (LLM) ── intent + panel list (with panel_reason per panel)
    │
    ▼
Profile (LLM) ── entity extraction
    │
    ├──► Tax / Cashflow ── pure-fn signals → LLM strategy text
    │
    ▼
Simulation ── financial.calculator.js (math) → LLM summary text
    │
    ▼
Portfolio ── portfolio.compute.js (math) → LLM rationale text
    │
    ▼
Risk ── risk.compute.js (math) → LLM factor text
    │
    ▼
Explanation (LLM) ── synthesises all computed state → plain text
    │
    ▼
UIComposer (deterministic) ── composeUI(plan, state) → A2UI v2 schema
    { id, type, data, meta:{priority,layout,trigger,stage,behavior},
      insight:{reason,summary,confidence}, actions[] }
    │
    ▼
Angular DynamicRenderer ── renders components from schema

── (parallel, event-driven) ──────────────────────────────────────
ReactiveEngine ── recomputes simulation/portfolio/risk on any
                  upstream state change — ZERO LLM calls
```

---

## Key Architectural Properties

| Property | Answer |
|----------|--------|
| Who computes savings projections? | `financial.calculator.js` — never the LLM |
| Who computes risk score? | `risk.compute.js` — 3-factor deterministic formula |
| If income changes, does simulation rerun? | Yes — ReactiveEngine guarantees it |
| Can two runs produce different numbers? | No — compute functions are pure |
| Where is the single source of truth? | `StateManager` (in-process) + `Redis` (durable) |
| Is raw PII ever stored? | No — sanitized to range labels before any storage |
| Who decides UI layout, priority, trigger? | `ui.composer.js` — deterministic component registry |
| What does the frontend render? | A2UI v2 schema: `{id, type, data, meta, insight, actions}` |
| Can new panels be added without frontend deploy? | Yes — UIComposer registry is server-side only |

---

## Documentation

| File | Contents |
|------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layered architecture, state model, agent contract, LLM boundary, dependency graph |
| [AGENTS.md](AGENTS.md) | All 9 agents: hybrid pipeline, inputs/outputs, compute rules |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | End-to-end flows, reactive consistency, trust-by-design explained |
| [WORKING.md](WORKING.md) | Demo script, expected logs, PII verification |
| [RUNBOOK.md](RUNBOOK.md) | Setup, API reference, environment config |
| [SYSTEM-DOCUMENTATION.md](SYSTEM-DOCUMENTATION.md) | Complete technical reference (23 sections) |
