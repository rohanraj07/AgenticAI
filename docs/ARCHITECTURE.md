# Architecture — AI Financial Planner

> Version: v2 — State-driven, deterministic compute, LLM as interface only

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Numbers from math, not LLMs** | All financial projections, risk scores, and allocations come from deterministic JS functions. LLMs write text only. |
| **State drives execution** | A central state object is the single source of truth. Events trigger reactive recomputation — not LLM decisions. |
| **Planner = intent classifier only** | The LLM planner decides *what the user wants* and *which UI panels to show*. It does NOT control recomputation or execute logic. |
| **Reactive consistency** | When profile changes, simulation → portfolio → risk recompute automatically. The dependency map is in code, not in prompts. |
| **Trust-by-design** | Raw documents never stored. Raw PII abstracted immediately. Only range labels persist. |
| **Graceful degradation** | Redis, ChromaDB, and every LLM call have fallbacks. No single failure kills the pipeline. |

---

## Layered Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER LAYER                                                          │
│  Angular SPA: Chat · File Upload · DynamicRenderer · WebSocket      │
└─────────────────────────────┬──────────────────┬────────────────────┘
                              │ POST /api/chat    │ POST /api/upload
                              ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ROUTE LAYER (Express)                                               │
│  • Load Redis session → seed StateManager → seed ReactiveEngine     │
│  • Pass plannerContext hints (profileExists, simulationExists)       │
│  • Persist all agent outputs → emit domain events                   │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION LAYER (LangGraph StateGraph)                          │
│  • Sequential node execution with per-node withFallback()           │
│  • Conditional routing: plan.agents[] drives which nodes run        │
│  • node_planner SKIPPED if plan is pre-seeded (upload path)         │
│                                                                      │
│  Flow: planner→profile→[tax→cashflow→]simulation→portfolio→         │
│        risk→explanation                                              │
└─────────────────────────────┬───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  HYBRID AGENT LAYER                                                  │
│                                                                      │
│  Each agent = compute_fn(state) → numbers                           │
│                + llm_chain(numbers) → narrative text                │
│                                                                      │
│  Planner     → LLM: intent + UI decisions only                      │
│  Profile     → LLM: entity extraction from natural language         │
│  Simulation  → calculator.js math → LLM: summary text              │
│  Portfolio   → portfolio.compute.js → LLM: rationale text          │
│  Risk        → risk.compute.js → LLM: factor descriptions          │
│  Tax         → sub-agents (pure fn) → LLM: strategy text           │
│  Cashflow    → sub-agents (pure fn) → LLM: recommendation text     │
│  Explanation → LLM: final narrative (references computed state)     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ events
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REACTIVE ENGINE LAYER (zero LLM calls)                              │
│                                                                      │
│  StateManager — per-session canonical state                          │
│    { profile, simulation, portfolio, risk, tax, cashflow }           │
│                                                                      │
│  ReactiveEngine — dependency-map cascade                             │
│    PROFILE_UPDATED    → recompute simulation, portfolio, risk       │
│    TAX_UPDATED        → recompute simulation                         │
│    CASHFLOW_UPDATED   → recompute simulation                         │
│    SIMULATION_UPDATED → recompute portfolio, risk                    │
│    PORTFOLIO_UPDATED  → recompute risk                               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ read/write
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MEMORY LAYER — PII-SAFE BY DESIGN                                   │
│                                                                      │
│  Redis (session JSON)   │  Markdown (.md files)  │  ChromaDB (RAG) │
│  TTL: 1 hour            │  LLM context injection  │  session-scoped │
│  No raw PII             │  Abstracted signals only│  No raw docs    │
└─────────────────────────────────────────────────────────────────────┘
                                │ events (WS push)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EVENT BUS (AppEventEmitter)                                         │
│  WS route filters by sessionId → broadcasts to Angular client       │
│  Events: AGENT_STARTED, PROFILE_UPDATED, SIMULATION_UPDATED, …     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Three Guarantees This Architecture Provides

### Guarantee 1: If income changes, simulation ALWAYS reruns

```
ProfileAgent saves new profile → Redis
chat.route.js emits PROFILE_UPDATED
     │
     ▼
ReactiveEngine receives PROFILE_UPDATED
     │
     ├── recomputeSimulation(state)   ← financial.calculator.js, no LLM
     ├── recomputePortfolio(state)    ← portfolio.compute.js, no LLM
     └── recomputeRisk(state)         ← risk.compute.js, no LLM
```

The system, not the LLM, guarantees this recomputation.

### Guarantee 2: Two runs produce the same numbers for the same inputs

Every financial number is produced by a pure function:

```javascript
// This will always produce the same result for the same profile
calculateRetirementProjection({ age: 35, income: 80000, savings: 200000, ... })
// → { projected_savings: 1_203_847, can_retire: true, ... }

computePortfolioAllocation({ risk_tolerance: 'medium', age: 35, retirement_age: 65 })
// → { allocation: [{Equities: 60}, {Bonds: 30}, ...], strategy: 'balanced', ... }

computeRiskScore(profile, portfolio, simulation)
// → { overall_risk_score: 5, risk_level: 'medium', ... }
```

LLM narrative text varies — numbers never do.

### Guarantee 3: LLM failure cannot corrupt financial data

The planner's job is intent classification only. If it fails, `SAFE_DEFAULT_PLAN` runs. All financial numbers are computed deterministically regardless of LLM output quality.

---

## State Model — Single Source of Truth

```javascript
// The canonical state shape per session
state = {
  profile:    { age, income, savings, monthly_expenses, retirement_age, risk_tolerance, goals },
  simulation: { can_retire_at_target, projected_savings_at_retirement, savings_gap,
                monthly_shortfall_or_surplus, years_of_runway, milestones[3], summary },
  portfolio:  { allocation[], strategy, expected_annual_return_percent,
                rebalance_frequency, rationale },
  risk:       { overall_risk_score, risk_level, factors[], mitigation_steps[], stress_test{} },
  tax:        { tax_efficiency_score, tax_bracket, optimization_strategies[], ... },
  cashflow:   { budget_health, savings_rate_label, spending_level, recommendations[], ... }
}
```

This lives in:
- **StateManager** (in-process, for ReactiveEngine access)
- **Redis** (durable, TTL 1 hour)
- **Markdown** (human-readable context for LLM)

All three are kept in sync. StateManager is seeded from Redis on every request.

---

## Agent Contract

Every compute-layer agent follows a pure function signature:

```javascript
function agent(state) → updatedPartialState
```

Rules:
- No randomness
- No LLM inside computation
- No chat history dependency
- Same input → same output, always

Examples:

```javascript
// Retirement projection: deterministic compound interest
calculateRetirementProjection(state.profile)
  → { projected_savings, required_savings, savings_gap, milestones }

// Portfolio: deterministic glide-path allocation
computePortfolioAllocation(state.profile, state.simulation)
  → { allocation[], strategy, expected_annual_return_percent }

// Risk: deterministic 3-factor scoring
computeRiskScore(state.profile, state.portfolio, state.simulation)
  → { overall_risk_score, risk_level, stress_test{} }
```

The LLM runs *after* these to write narrative — it cannot change the numbers.

---

## LLM Boundary

### What the LLM CAN do

| Allowed | Agent | Why |
|---------|-------|-----|
| Classify user intent | Planner | Natural language understanding |
| Decide UI panels | Planner | Composition of rendering hints |
| Extract structured data from text | Profile | Entity recognition |
| Write summary narrative | Simulation | Human communication |
| Write rationale text | Portfolio | Human communication |
| Write factor descriptions | Risk | Human communication |
| Write strategy recommendations | Tax / Cashflow | Human communication |
| Write final explanation | Explanation | Human communication |

### What the LLM CANNOT do

| Forbidden | Enforcement |
|-----------|-------------|
| Compute savings projections | `financial.calculator.js` runs first; LLM receives pre-computed numbers |
| Decide portfolio allocation % | `portfolio.compute.js` runs first; LLM receives pre-computed allocation |
| Set the risk score | `risk.compute.js` runs first; LLM receives pre-computed score |
| Compute stress test amounts | `risk.compute.js` runs first; LLM receives pre-computed dollar impacts |
| Trigger or skip recomputation | ReactiveEngine dependency map is hardcoded in JS |
| Store or access raw PII | PII sanitizer discards raw values before any chain invocation |
| Control agent execution order | LangGraph routing functions are pure conditional code |

---

## Dependency Graph

```
PROFILE_UPDATED
    ├──► simulation  (recalculate FV, savings gap, milestones)
    │         ├──► portfolio  (recalculate allocation for new gap)
    │         └──► risk       (recalculate score with new gap + new allocation)
    └──► portfolio  (recalculate glide path for new age)
              └──► risk       (recalculate score with new allocation)

TAX_UPDATED
    └──► simulation  (tax signals may affect effective savings rate)

CASHFLOW_UPDATED
    └──► simulation  (spending signals affect monthly savings calculation)

PORTFOLIO_UPDATED
    └──► risk        (equity % change → risk score change)
```

All cascade steps are deterministic. Zero LLM calls in any reactive recomputation.

---

## A2UI — Agent-to-UI Dynamic Rendering

The server decides which UI panels to render. The frontend is a pure rendering layer.

```
Planner output: plan.ui = [
  { type: "profile_summary" },
  { type: "simulation_chart" },
  { type: "explanation_panel" }
]
         │
Angular DynamicRendererComponent maps type → component
```

UI evolves as data arrives:

| Trigger | UI Panels |
|---------|-----------|
| First chat | `profile_summary`, `simulation_chart`, `explanation_panel` |
| Risk question | + `risk_dashboard`, `portfolio_view` |
| Tax doc uploaded | + `tax_panel`, simulation updates |
| Bank statement | + `cashflow_panel`, simulation updates |

---

## Trust-by-Design — PII Architecture

```
Raw document (in-memory only, never on disk)
        │
        ▼
DocumentIngestionAgent
  LLM: classify doc → extract raw_values (EPHEMERAL, in-memory only)
        │
  PII Sanitizer:
    grossIncome: 148500     → income_range: "HIGH"         ← stored
    effectiveTaxRate: 18.5  → effective_rate: "18.5%"      ← stored
    SSN: XXX-XX-1234        → [NEVER extracted to any field]
    raw_values              → DISCARDED  ← key step
        │
        ▼
taxInsights = { income_range, tax_bracket, effective_rate, deductions_level }
        │
        ▼
Redis / Markdown / ChromaDB — abstractions only
```

### What is NEVER stored

- Raw document files (multer uses `memoryStorage`)
- SSNs, account numbers, exact dollar amounts from documents
- Transaction-level data

### What IS stored (abstracted signals only)

- `income_range`: LOW / LOWER_MIDDLE / MIDDLE / UPPER_MIDDLE / HIGH / VERY_HIGH
- `tax_bracket`: 10% / 22% / 24% / 32% / 35% / 37%+
- `spending_level`: FRUGAL / MODERATE / ELEVATED / HIGH / OVERSPENDING
- `savings_rate`: VERY_LOW / LOW / MODERATE / GOOD / EXCELLENT
- Agent output objects (scores, strategy text, recommendations)

---

## Multi-Provider LLM Support

```javascript
// Priority chain (first matching env var wins):
GROQ_API_KEY    → Groq llama-3.3-70b-versatile  (free, fast — recommended)
GEMINI_API_KEY  → Google Gemini 2.0 Flash        (free tier, 1500 req/day)
OPENAI_API_KEY  → OpenAI GPT-4o-mini             (paid, highest quality)
fallback        → Ollama llama3.2                (local, fully offline)

// Embedding model is resolved independently:
OLLAMA_EMBEDDING_MODEL → nomic-embed-text  (dedicated, recommended)
OPENAI_EMBEDDING_MODEL → text-embedding-3-small
GEMINI_EMBEDDING_MODEL → text-embedding-004
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Conversational endpoint — full pipeline |
| `POST` | `/api/upload` | Multi-modal document upload |
| `GET` | `/api/session/:id` | Retrieve session state |
| `GET` | `/api/health` | Service status |
| `WS` | `ws://localhost:3000` | Real-time agent events |

---

## Future-Ready Extensions

| Capability | Current | Production Path |
|------------|---------|-----------------|
| Encryption | None | AES-256 at rest, TLS in transit |
| RBAC | None | OAuth2 + role-based agent access |
| Audit logs | Markdown + console | Immutable append-only audit trail |
| Right-to-delete | Session purge | Vector deletion + Redis DEL + file rm |
| PDF parsing | Text only | Apache Tika / AWS Textract |
| Real APIs | LLM reasoning | Plaid, IRS e-file, brokerage APIs |
| Horizontal scale | Single process | Redis + ReactiveEngine → shared state |
