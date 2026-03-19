# Architecture — AI Financial Planner POC

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Intelligent** | LLM decides agent routing and UI layout (not hardcoded rules) |
| **Reactive** | EventEmitter → WebSocket → Angular Subject — events flow in real time |
| **Multi-modal** | File upload (tax docs, bank statements) + chat input |
| **Trustworthy** | PII-by-design — raw documents never stored; only abstracted signals persist |

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER LAYER                                  │
│  Chat Input  │  Profile Form  │  File Upload (.txt / .json)         │
└──────────────┴────────────────┴─────────────────────────────────────┘
                          │ HTTP / WebSocket
┌─────────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION LAYER                             │
│   Express API  ─── LangGraph StateGraph ─── EventEmitter/WebSocket  │
│     /api/chat           │                                           │
│     /api/upload    PlannerAgent                                     │
└────────────────────────┼────────────────────────────────────────────┘
                          │  DAG routing
┌─────────────────────────────────────────────────────────────────────┐
│                       AGENT LAYER (9 agents)                        │
│                                                                     │
│  planner → profile ──────────────────────────────────┐             │
│            │                                         │             │
│            ├─ document_ingestion → tax ──────────────┤             │
│            │                    → cashflow ──────────┤             │
│            │                                         ▼             │
│            └─ simulation → portfolio → risk → explanation           │
└─────────────────────────────────────────────────────────────────────┘
                          │  persist sanitized data only
┌─────────────────────────────────────────────────────────────────────┐
│              MEMORY LAYER — PII-SAFE BY DESIGN                      │
│                                                                     │
│  Redis (session JSON)   │  Markdown (.md files)  │  ChromaDB (RAG) │
│  ─ sanitized profile    │  ─ abstracted signals   │  ─ insights     │
│  ─ simulation results   │  ─ redacted summaries   │  ─ no raw docs  │
│  ─ tax insights only    │  ─ no PII               │  ─ deletable    │
│  TTL: 1 hour            │  human-readable for LLM │  semantic search│
└─────────────────────────────────────────────────────────────────────┘
```

---

## A2UI — Agent-to-UI Dynamic Rendering

**The server IS the composer.** The planner agent decides which UI panels to render based on what data is available. The frontend never hardcodes a layout.

```
Server:  plan.ui = [{ type: "tax_panel" }, { type: "simulation_chart" }, { type: "explanation_panel" }]
                                    │
Frontend: DynamicRendererComponent maps type → Angular component
                                    │
Result:   Tax panel + Simulation chart + Explanation panel render dynamically
```

### UI Evolution with Data

| Event | UI Panels Rendered |
|-------|--------------------|
| First chat message | `profile_summary`, `simulation_chart`, `explanation_panel` |
| Risk question | + `risk_dashboard`, `portfolio_view` |
| Tax doc uploaded | + `tax_panel`, `simulation_chart` (updated) |
| Bank statement uploaded | + `cashflow_panel`, `explanation_panel` |
| "What should I improve?" | `explanation_panel`, recommendations |

---

## A2A — Agent-to-Agent Communication

Agents communicate via the **LangGraph shared state object** — each node reads upstream results and writes its own channel.

```
State channels: message, plan, profile, simulation, portfolio, risk,
                tax, cashflow, taxInsights, cashflowInsights,
                ragContext, memory, explanation, trace
```

**Routing is conditional** — the planner agent's output (`plan.agents[]`) drives which nodes execute:

```
planner output: { agents: ["profile", "tax", "simulation", "explanation"] }
    → node_profile runs → reads message
    → node_tax runs     → reads taxInsights (pre-seeded from upload)
    → node_simulation   → reads profile + taxInsights
    → node_explanation  → reads all prior results
```

---

## Trust-by-Design — PII Architecture

```
UPLOAD FLOW:
  Raw document (in-memory buffer, never on disk)
        │
        ▼
  DocumentIngestionAgent
        │ LLM extracts raw_values ephemerally
        │ PII Sanitizer converts → abstractions
        │ raw_values DISCARDED
        ▼
  taxInsights: {
    income_range: "HIGH",          ← not "$148,500"
    tax_bracket: "32%",            ← marginal bracket label
    deductions_level: "MODERATE",  ← not "$32,600"
    filing_status: "married_filing_jointly"
  }
        │
        ▼
  TaxAgent / CashflowAgent operate on abstractions only
        │
        ▼
  Redis / Markdown / ChromaDB store abstractions only
```

### What is NEVER stored

- Raw document files (multer uses `memoryStorage` — no disk writes)
- SSNs, account numbers, exact dollar amounts
- Full names beyond what user provides in chat
- Transaction-level data

### What IS stored (abstracted signals only)

- `income_range`: LOW / MIDDLE / HIGH / VERY_HIGH
- `tax_bracket`: 10-12% / 22% / 24% / 32% / 35% / 37%+
- `deductions_level`: LOW / MODERATE / HIGH / VERY_HIGH
- `spending_level`: FRUGAL / MODERATE / ELEVATED / HIGH / OVERSPENDING
- `savings_rate`: VERY_LOW / LOW / MODERATE / GOOD / EXCELLENT
- `budget_health`: excellent / good / fair / poor

---

## Memory Layer Details

### Redis — Session State
- Short-lived (TTL: 1 hour, configurable)
- Stores: `{ profile, simulation, portfolio, risk, tax, cashflow }`
- No raw documents, no transaction data
- Falls back to in-memory `Map` when unavailable

### Markdown Files — LLM Context
- Written to `backend/data/sessions/<sessionId>.md`
- Contains abstracted signals only (PII policy header included)
- Injected into LLM prompts as reasoning context
- Human-readable audit trail

### ChromaDB — Semantic RAG
- Stores anonymized insight summaries (not raw documents)
- `"Document analysis: User in high income bracket, 32% bracket, moderate deductions"`
- Enables semantic retrieval across sessions
- Falls back to keyword search when unavailable

---

## LLM Provider Auto-Detection

```javascript
if (process.env.OPENAI_API_KEY) {
  // Work laptop: OpenAI GPT-4o-mini + text-embedding-3-small
} else {
  // Local: Ollama llama3.2 + OllamaEmbeddings
}
```

### Minimal Work Laptop Setup
Only needs: `OPENAI_API_KEY` in `.env`. Redis, ChromaDB, Ollama all optional (graceful fallback).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Main conversational endpoint |
| `POST` | `/api/upload` | Multi-modal document upload (trust-by-design) |
| `GET` | `/api/session/:id` | Retrieve session state |
| `GET` | `/api/health` | Service status (LLM, Redis, ChromaDB) |
| `WS` | `ws://localhost:3000` | Real-time agent events |

---

## Future-Ready Extensions

| Capability | Current POC | Production Path |
|------------|-------------|-----------------|
| Encryption | None | AES-256 at rest, TLS in transit |
| Tokenization | None | Vault-based token references |
| RBAC | None | OAuth2 + role-based agent access |
| Audit logs | Console + markdown | Immutable audit trail (append-only) |
| Right-to-delete | None | Session purge API + vector deletion |
| PDF parsing | Text-only | Apache Tika / AWS Textract |
| Real APIs | LLM reasoning | Plaid, IRS e-file, brokerage APIs |
