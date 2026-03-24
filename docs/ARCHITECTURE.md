# Architecture — AI Financial Planner

> Version: v3 — Priority event queue · Conflict resolution · Full/Partial recompute · A2UI v2 with versioning

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Numbers from math, not LLMs** | All financial projections, risk scores, and allocations come from deterministic JS functions. LLMs write text only. |
| **State drives execution** | A versioned central state object is the single source of truth. `_version` increments on every update — enables stale detection on client. |
| **Planner = intent classifier only** | The LLM planner decides *what the user wants* and *which UI panels to show* (with `panel_reason`). It does NOT control recomputation, layout, or execution order. |
| **Reactive consistency** | When profile changes, simulation → portfolio → risk recompute automatically. Dependency map is hardcoded in JS — not in any prompt. |
| **Priority-driven events** | PROFILE_UPDATED (HIGH) pre-empts PORTFOLIO_UPDATED (MEDIUM). Coalescing prevents duplicate cascades. |
| **Conflict resolution** | When the same field arrives from multiple sources, deterministic precedence rules decide the winner: `document_extracted > user_stated > inferred > default`. |
| **Full vs Partial recompute** | PROFILE_UPDATED triggers a full cascade. TAX_UPDATED triggers only simulation (partial). Decision is in code, not LLM. |
| **Stale cascade cancellation** | Higher-priority event aborts a running lower-priority cascade via AbortController (StaleGuard). No stale intermediate state. |
| **PII write enforcement** | SchemaValidator blocks any `updateSession()` call that contains raw PII fields. Throws `SchemaViolationError` — never silently ignored. |
| **Trust-by-design** | Raw documents never stored. Raw PII abstracted immediately. Only range labels persist. |
| **A2UI v2 orchestration** | Server produces `{id, type, data, meta, insight, actions, version}` per panel. Frontend is a pure renderer. |
| **Graceful degradation** | Redis, ChromaDB, and every LLM call have fallbacks. No single failure kills the pipeline. |

---

## Layered Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  USER LAYER                                                           │
│  Angular SPA: Chat · File Upload · DynamicRenderer · WebSocket       │
│  DynamicRenderer reads A2UI v2 schema — version-checks each panel    │
└──────────────────────────────┬─────────────────┬─────────────────────┘
                               │ POST /api/chat   │ POST /api/upload
                               ▼                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ROUTE LAYER (Express)                                                │
│  • Load Redis session → seed StateManager → seed ReactiveEngine      │
│  • composeLoadingState(plan) → skeleton A2UI sent immediately        │
│  • Persist all agent outputs → emit domain events (with priority)    │
│  • composeUI(plan, state) → A2UI v2 (loading:false, version:N)       │
│  • Persist uiContext to Redis                                         │
└──────────────────────────────┬────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION LAYER (LangGraph StateGraph)                           │
│  • Sequential node execution with per-node withFallback()            │
│  • Conditional routing: plan.agents[] drives which nodes run         │
│  • node_planner SKIPPED if plan is pre-seeded (upload path)          │
│                                                                       │
│  Flow: planner→profile→[tax→cashflow→]simulation→portfolio→          │
│        risk→explanation                                               │
└──────────────────────────────┬────────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  HYBRID AGENT LAYER                                                   │
│                                                                       │
│  Each agent = compute_fn(state) → numbers                            │
│              + llm_chain(numbers) → narrative text                   │
│                                                                       │
│  Planner     → LLM: intent + panel list (with panel_reason)          │
│  Profile     → LLM: entity extraction + ConflictResolver merge       │
│  Simulation  → calculator.js math → LLM: summary text               │
│  Portfolio   → portfolio.compute.js → LLM: rationale text           │
│  Risk        → risk.compute.js → LLM: factor descriptions           │
│  Tax         → sub-agents (pure fn) → LLM: strategy text            │
│  Cashflow    → sub-agents (pure fn) → LLM: recommendation text      │
│  Explanation → LLM: final narrative (references computed state)      │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ events (with priority + timestamp)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  REACTIVE ENGINE LAYER (zero LLM calls)                               │
│                                                                       │
│  PriorityQueue — event coalescing                                     │
│    HIGH (1): PROFILE_UPDATED                                          │
│    MEDIUM (2): TAX/CASHFLOW/PORTFOLIO/SIMULATION updated             │
│    LOW (3): EXPLANATION_READY, AGENT_STARTED, AGENT_COMPLETED        │
│    Deduplication: same (event, sessionId) → payload merged, 1 entry  │
│                                                                       │
│  StaleGuard — mid-cascade abort                                       │
│    AbortController per running cascade                                │
│    Higher-priority event: abort() + start fresh cascade              │
│    ReactiveEngine checks signal.aborted before each compute step     │
│    clear() in finally block — no leak                                 │
│                                                                       │
│  ReactiveEngine — dependency-map cascade                              │
│    _pendingCascades Map prevents overlapping cascades per session     │
│    FULL:    PROFILE_UPDATED → simulation, portfolio, risk            │
│    PARTIAL: TAX_UPDATED → simulation only                            │
│    PARTIAL: CASHFLOW_UPDATED → simulation only                       │
│    PARTIAL: SIMULATION_UPDATED → portfolio, risk                     │
│    PARTIAL: PORTFOLIO_UPDATED → risk only                            │
│                                                                       │
│  ConflictResolver — data source precedence                            │
│    document_extracted(4) > user_stated(3) > inferred(2) > default(1) │
│    Tie-break: confidence → timestamp                                  │
│                                                                       │
│  StateManager — per-session canonical state                           │
│    { profile, simulation, portfolio, risk, tax, cashflow,            │
│      uiContext, _version }                                            │
│    _version++ on every update() — enables stale detection            │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ read/write
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MEMORY LAYER — PII-SAFE BY DESIGN                                    │
│                                                                       │
│  Redis (session JSON)   │  Markdown (.md files)  │  ChromaDB (RAG)  │
│  TTL: 1 hour            │  LLM context injection  │  session-scoped  │
│  Includes _version      │  Abstracted signals only│  No raw docs     │
│  Optimistic lock via    │                         │  queryForSession │
│  _expectedVersion       │                         │  storeForSession │
│  SchemaValidator gate   │                         │  throw on no-id  │
└──────────────────────────────────────────────────────────────────────┘
                                 │ events (WS push)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EVENT BUS (AppEventEmitter)                                          │
│  Events carry: { sessionId, data, priority, timestamp }              │
│  WS route filters by sessionId → broadcasts to Angular client        │
│  Events: AGENT_STARTED, PROFILE_UPDATED, SIMULATION_UPDATED, …      │
│  New: CONFLICT_RESOLVED (fired when ConflictResolver changes a field) │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The Three Guarantees

### Guarantee 1: If income changes, simulation ALWAYS reruns

```
ProfileAgent saves new profile → StateManager._version++
chat.route.js emits PROFILE_UPDATED (priority: HIGH, timestamp: T)
     │
     ▼
PriorityQueue: HIGH → processed first (before any MEDIUM/LOW in queue)
     │
     ▼
ReactiveEngine receives PROFILE_UPDATED → FULL cascade
     │
     ├── recomputeSimulation(state)   ← financial.calculator.js, ~1ms, no LLM
     ├── recomputePortfolio(state)    ← portfolio.compute.js, ~1ms, no LLM
     └── recomputeRisk(state)         ← risk.compute.js, ~1ms, no LLM
```

The system, not the LLM, guarantees this recomputation.

### Guarantee 2: Two runs produce the same numbers for the same inputs

Every financial number is produced by a pure function:

```javascript
calculateRetirementProjection({ age: 35, income: 80000, savings: 200000, ... })
// → same result every run, no randomness

computePortfolioAllocation({ risk_tolerance: 'medium', age: 35, retirement_age: 65 })
// → same allocation every run

computeRiskScore(profile, portfolio, simulation)
// → same score every run
```

LLM narrative text varies per run. Numbers never do.

### Guarantee 3: LLM failure cannot corrupt financial data

If the planner chain fails, `SAFE_DEFAULT_PLAN` activates. All financial numbers are computed deterministically regardless of LLM output quality. The LLM only writes sentences — it never computes values.

---

## State Model — Single Source of Truth

```javascript
// The canonical state shape per session (StateManager + Redis)
state = {
  profile:    { age, income, savings, monthly_expenses, retirement_age, risk_tolerance, goals },
  simulation: { can_retire_at_target, projected_savings_at_retirement, savings_gap,
                monthly_shortfall_or_surplus, years_of_runway, milestones[3], summary },
  portfolio:  { allocation[], strategy, expected_annual_return_percent,
                rebalance_frequency, rationale },
  risk:       { overall_risk_score, risk_level, factors[], mitigation_steps[], stress_test{} },
  tax:        { tax_efficiency_score, tax_bracket, optimization_strategies[], ... },
  cashflow:   { budget_health, savings_rate_label, spending_level, recommendations[], ... },
  uiContext:  A2UIComponent[],   // ← last A2UI v2 schema, persisted to Redis
  _version:   number,            // ← increments on every StateManager.update()
}
```

`_version` is never written by the caller — StateManager always computes it:

```javascript
update(sessionId, patch) {
  const current = this.get(sessionId);
  const next    = { ...current, ...patch, _version: (current._version ?? 0) + 1 };
  // ...
}
```

---

## Event System

### Priority table

| Event | Priority | Recompute Type | Downstream |
|-------|----------|---------------|------------|
| `PROFILE_UPDATED` | HIGH (1) | FULL | simulation, portfolio, risk |
| `TAX_UPDATED` | MEDIUM (2) | PARTIAL | simulation |
| `CASHFLOW_UPDATED` | MEDIUM (2) | PARTIAL | simulation |
| `SIMULATION_UPDATED` | MEDIUM (2) | PARTIAL | portfolio, risk |
| `PORTFOLIO_UPDATED` | MEDIUM (2) | PARTIAL | risk |
| `EXPLANATION_READY` | LOW (3) | UI only | — |
| `AGENT_STARTED` | LOW (3) | UI only | — |
| `CONFLICT_RESOLVED` | LOW (3) | logging only | — |

### Coalescing pseudo-code

```
enqueue(event, sessionId, payload, priority):
  key = "${event}:${sessionId}"
  if key in _map:
    _map[key].payload = { ..._map[key].payload, ...payload }  // merge
    _map[key].updatedAt = now()
    return  // no duplicate entry
  entry = { event, sessionId, payload, priority, insertedAt: now() }
  _map[key] = entry
  _queue.push(entry)

drain() → sort by priority ASC, insertedAt ASC → return + clear
```

---

## Conflict Resolution

### Precedence table

| Source | Rank | Applied when |
|--------|------|-------------|
| `document_extracted` | 4 | Field came from an uploaded document |
| `user_stated` | 3 | User typed the value explicitly in chat |
| `inferred` | 2 | LLM extracted from ambiguous text |
| `default` | 1 | System fallback / placeholder |

Tie-breaking: `confidence` → `timestamp` (most recent wins).

### Data quality scoring

`ConflictResolver.scoreDataQuality(profile)` → 0.0–1.0:
- Start at 1.0
- -1/7 per missing field (7 full profile fields)
- -0.15 extra per missing critical field (`income`, `retirement_age`)
- Score surfaced in A2UI `insight.confidence` per panel

---

## A2UI v2 — Agent-to-UI Orchestration

### Component schema

```typescript
interface A2UIComponent {
  id:      string;               // "{type}-{position}"
  type:    string;               // "simulation_chart", "tax_panel", etc.
  loading: boolean;              // true during skeleton phase
  version: number;               // state._version at composition time
  data:    Record<string, any>;  // pre-fetched state slice
  meta: {
    priority:    'high' | 'medium' | 'low';
    layout:      'full_width' | 'half' | 'sidebar';
    position:    number;
    trigger:     string | null;  // WebSocket event that refreshes panel
    stage:       'summary' | 'detailed' | 'recommendation';
    behavior:    { expandOnLoad: boolean; interactive: boolean };
  };
  insight: {
    reason:     string;   // WHY (from planner panel_reason)
    summary:    string;   // WHAT (derived from state, deterministic)
    confidence: number;   // 0.0–1.0
  };
  actions: { label: string; action: string }[];
}
```

### UIComposer functions

| Function | Purpose |
|----------|---------|
| `composeLoadingState(plan)` | Skeleton components (loading:true) — sent immediately after planner |
| `composeUI(plan, state)` | Full components (loading:false, data:filled) — sent after agents run |

### Component registry (deterministic, no LLM)

| Type | Priority | Layout | Stage | Trigger |
|------|----------|--------|-------|---------|
| `profile_summary` | high | half | summary | PROFILE_UPDATED |
| `simulation_chart` | high | full_width | summary | SIMULATION_UPDATED |
| `portfolio_view` | medium | half | detailed | PORTFOLIO_UPDATED |
| `risk_dashboard` | medium | half | detailed | RISK_UPDATED |
| `tax_panel` | high | full_width | recommendation | TAX_UPDATED |
| `cashflow_panel` | medium | full_width | recommendation | CASHFLOW_UPDATED |
| `explanation_panel` | high | full_width | summary | EXPLANATION_READY |

---

## Agent Contract

Every compute-layer agent follows a pure function signature:

```javascript
function agent(state) → updatedPartialState
// No randomness, no LLM inside computation, same input → same output always
```

---

## LLM Boundary

### What the LLM CAN do

| Allowed | Agent |
|---------|-------|
| Classify user intent | Planner |
| Output panel list with `panel_reason` per panel | Planner |
| Extract structured data from text | Profile |
| Write summary narrative | Simulation |
| Write rationale text | Portfolio |
| Write factor descriptions | Risk |
| Write strategy recommendations | Tax / Cashflow |
| Write final explanation | Explanation |

### What the LLM CANNOT do

| Forbidden | Enforcement |
|-----------|-------------|
| Compute savings projections | `financial.calculator.js` runs first |
| Decide portfolio allocation % | `portfolio.compute.js` runs first |
| Set the risk score | `risk.compute.js` runs first |
| Compute stress test amounts | `risk.compute.js` runs first |
| Trigger or skip recomputation | ReactiveEngine dependency map is hardcoded |
| Resolve conflicting data | ConflictResolver precedence rules |
| Decide UI layout or priority | UIComposer component registry |
| Store raw PII (1st defense) | PII sanitizer maps values to labels before any write |
| Store raw PII (2nd defense) | SchemaValidator throws on every `updateSession()` if forbidden fields detected |
| Cross-session vector reads | `queryForSession()` throws if sessionId missing |

---

## Dependency Graph

```
PROFILE_UPDATED (FULL)
    ├──► simulation  (FV math, savings gap, milestones)
    │         ├──► portfolio  (glide-path allocation)
    │         └──► risk       (3-factor score + stress tests)
    └──► portfolio  (age-based glide path)
              └──► risk       (equity % → score)

TAX_UPDATED (PARTIAL)
    └──► simulation  (tax signals affect effective savings rate)

CASHFLOW_UPDATED (PARTIAL)
    └──► simulation  (spending signals affect monthly surplus)

PORTFOLIO_UPDATED (PARTIAL)
    └──► risk        (equity % change → risk score change)
```

All cascade steps: deterministic, ~1–3ms each, zero LLM calls.

---

## Failure & Fallback Strategy

| Component | Failure | Fallback |
|-----------|---------|---------|
| Redis | Connection refused | In-process Map (StateManager._store) |
| ChromaDB | Unavailable | Keyword search fallback |
| LLM API | Timeout / error | `withFallback()` + hardcoded text |
| Planner chain | JSON parse fail | `SAFE_DEFAULT_PLAN` |
| ReactiveEngine cascade | Agent compute throws | Error logged; other agents still run |
| StaleGuard abort | Higher-priority event mid-cascade | Current cascade exits early; fresh cascade starts |
| SchemaValidator | Forbidden PII field in patch | `SchemaViolationError` thrown — write blocked, not silently ignored |
| OptimisticLockError | Version mismatch on write | Error thrown — caller can retry with fresh read |
| PriorityQueue drain | Empty | No-op |
| ConflictResolver | Missing source | Defaults to `inferred` rank |

---

## Trust-by-Design — PII Architecture

```
Raw document (in-memory only, never on disk)
        │
        ▼
DocumentIngestionAgent
  LLM: classify → extract raw_values (ephemeral, local variable)
        │
  PII Sanitizer:
    grossIncome: 148500     → income_range: "HIGH"         ← stored
    effectiveTaxRate: 18.5  → effective_rate: "18.5%"      ← stored
    SSN: XXX-XX-1234        → [NEVER extracted]
    raw_values              → DISCARDED
        │
        ▼
taxInsights = { income_range, tax_bracket, effective_rate }
        │
        ▼
Redis / Markdown / ChromaDB — abstractions only
```

---

## Multi-Provider LLM Support

```javascript
// Priority chain (first matching env var wins):
GROQ_API_KEY    → Groq llama-3.3-70b-versatile  (free, fast — recommended)
GEMINI_API_KEY  → Google Gemini 2.0 Flash        (free tier, 1500 req/day)
OPENAI_API_KEY  → OpenAI GPT-4o-mini             (paid, highest quality)
fallback        → Ollama llama3.2                (local, fully offline)
```
