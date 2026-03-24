# AI Financial Planner — POC

> **Architecture**: Reactive, deterministic financial engine with an AI orchestration layer.
> Numbers from math. Text from LLMs. Control flow from code. UI schema from the server.
> Version: v3

| Layer | Technology |
|-------|------------|
| LLM Orchestration | LangChain.js |
| Agent Flow | LangGraph StateGraph |
| Event System | Priority queue (HIGH/MEDIUM/LOW) + event coalescing |
| Reactive Engine | Dependency-map cascade (FULL/PARTIAL recompute, zero LLM) |
| Conflict Resolution | Source precedence: document_extracted > user_stated > inferred > default |
| Compute Modules | Pure JS math (compound interest, glide path, risk scoring) |
| A2UI Orchestration | UIComposer — server controls WHAT/HOW/WHEN/WHY per panel |
| Backend | Node.js + Express + WebSocket |
| Frontend | Angular 17 (standalone components) |
| Session State | Redis (falls back to in-memory Map); versioned (`_version`) |
| Semantic Memory | ChromaDB (falls back to keyword search) |
| Human-readable Memory | Markdown files |
| LLM Providers | Groq (free) · Gemini (free) · OpenAI · Ollama (local) |

---

## Quick Start

### 1. Prerequisites

```bash
node --version   # 18+

# Option A: Groq (free, recommended)
echo "GROQ_API_KEY=gsk_..." >> backend/.env

# Option B: Ollama (local, no key needed)
brew install ollama
ollama pull llama3.2
ollama pull nomic-embed-text

# Optional: Redis + ChromaDB (both have graceful fallbacks)
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 8000:8000 chromadb/chroma
```

### 2. Backend

```bash
cd backend && npm install && npm run dev
```

### 3. Frontend

```bash
cd frontend && npm install && npm start
# Opens at http://localhost:4200
```

---

## Architecture in One Diagram

```
User Message
    │
    ▼
Planner (LLM) ── intent + panel list with panel_reason per panel
    │
    ├── composeLoadingState(plan) → skeleton A2UI panels sent immediately
    │
    ▼
Profile (LLM) ── entity extraction + ConflictResolver merge
    │
    ├──► Tax / Cashflow ── pure-fn signals → LLM strategy text
    │
    ▼
Simulation ── financial.calculator.js (math, ~1ms) → LLM summary text
    │
    ▼
Portfolio ── portfolio.compute.js (math, ~1ms) → LLM rationale text
    │
    ▼
Risk ── risk.compute.js (math, ~1ms) → LLM factor text
    │
    ▼
Explanation (LLM) ── synthesises all computed state → plain text
    │
    ▼
UIComposer ── composeUI(plan, state) → A2UI v2
    { id, type, data, loading:false, version:N,
      meta:{priority,layout,trigger,stage,behavior},
      insight:{reason,summary,confidence}, actions[] }

── (parallel, event-driven) ──────────────────────────────────────────
PriorityQueue ── coalesces HIGH→MEDIUM→LOW events; deduplicates
ReactiveEngine ── FULL cascade on PROFILE_UPDATED (simulation→portfolio→risk)
               ── PARTIAL cascade on TAX/CASHFLOW/SIMULATION/PORTFOLIO events
               ── _pendingCascades prevents overlapping per session
               ── ZERO LLM calls in any reactive path
ConflictResolver ── document_extracted(4) > user_stated(3) > inferred(2) > default(1)
```

---

## Key Architectural Properties

| Property | Answer |
|----------|--------|
| Who computes savings projections? | `financial.calculator.js` — never the LLM |
| Who computes risk score? | `risk.compute.js` — 3-factor deterministic formula |
| If income changes, does simulation rerun? | Yes — ReactiveEngine FULL cascade guarantees it |
| Can two runs produce different numbers? | No — compute functions are pure |
| Where is the single source of truth? | `StateManager` (in-process, versioned) + `Redis` (durable) |
| Is raw PII ever stored? | No — sanitized to range labels before any storage |
| What if 3 PROFILE_UPDATED events fire at once? | PriorityQueue coalesces them into 1 cascade |
| Who resolves user input vs document data conflict? | `ConflictResolver` — document_extracted wins |
| Who decides UI layout, priority, trigger? | `UIComposer` — deterministic registry, no LLM |
| What does the frontend render? | A2UI v2: `{id, type, data, meta, insight, actions, version}` |
| How does the client avoid stale renders? | `version` field — client rejects version < lastSeen |
| Can new panels be added without frontend deploy? | Yes — UIComposer registry is server-side only |

---

## Event Priority

| Event | Priority | Recompute |
|-------|----------|-----------|
| `PROFILE_UPDATED` | HIGH (1) | FULL — all downstream |
| `TAX_UPDATED` | MEDIUM (2) | PARTIAL — simulation only |
| `CASHFLOW_UPDATED` | MEDIUM (2) | PARTIAL — simulation only |
| `SIMULATION_UPDATED` | MEDIUM (2) | PARTIAL — portfolio + risk |
| `PORTFOLIO_UPDATED` | MEDIUM (2) | PARTIAL — risk only |
| `EXPLANATION_READY` | LOW (3) | UI only |
| `CONFLICT_RESOLVED` | LOW (3) | Logging only |

---

## Documentation

| File | Contents |
|------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layered architecture, event system, conflict resolution, A2UI v2 schema, LLM boundary |
| [AGENTS.md](AGENTS.md) | All 9 agents: hybrid pipeline, inputs/outputs, compute formulas |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | End-to-end flows, 5 patterns, reactive consistency, failure handling |
| [WORKING.md](WORKING.md) | Demo script, expected logs, PII verification |
| [RUNBOOK.md](RUNBOOK.md) | Setup, API reference, environment config |
| [SYSTEM-DOCUMENTATION.md](SYSTEM-DOCUMENTATION.md) | Complete technical reference (24 sections) |
