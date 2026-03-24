# How It Works — AI Financial Planner

> "A reactive, deterministic financial engine with an AI orchestration layer."
> Version: v3 — Priority event queue · Conflict resolution · Partial/Full recompute · A2UI v2

---

## The Core Idea

Most AI financial tools let the LLM do everything — numbers, decisions, layout. This system draws a hard boundary:

```
WRONG (LLM-driven):
  User: "Can I retire at 55?"
  LLM: "Sure, with $500k you need $5M." ← hallucinated, changes every run

THIS system (deterministic engine + AI interface):
  calculator.js: FV = $200k × (1.07)^20 + $34k × ((1.07)^20 - 1)/0.07 = $1,203,847
  LLM: "Based on your projected $1,203,847 in savings..." ← wraps real numbers only
```

**The LLM is the interface. Math is the engine. Code is the orchestrator.**

---

## The Six Patterns

### Pattern 1 — State-Driven Execution

A single versioned source of truth per session:

```javascript
state = {
  profile:    { age: 35, income: 80000, savings: 200000, ... },
  simulation: { projected_savings: 1203847, can_retire: true, ... },
  portfolio:  { allocation: [{Equities:60},{Bonds:30},...], strategy: "balanced" },
  risk:       { overall_risk_score: 5, risk_level: "medium", ... },
  tax:        { tax_efficiency_score: 7, optimization_strategies: [...] },
  cashflow:   { budget_health: "good", recommendations: [...] },
  uiContext:  [...],   // A2UI v2 schema — last rendered panels
  _version:   14,      // increments on every update — enables stale-check on client
}
```

This lives in:
- **StateManager** — in-process (ReactiveEngine uses this for instant access, O(1) read)
- **Redis** — durable (persists across requests, TTL 1 hour, includes `_version`)
- **Markdown** — human-readable context injected into LLM prompts

`_version` is incremented by `StateManager.update()` on every patch. The client can reject A2UI components whose `version < lastSeenVersion` to prevent stale renders.

---

### Pattern 2 — Priority Event Queue

Events are not treated equally. High-urgency events (profile changes) pre-empt lower-urgency ones.

```
Priority Levels:
  HIGH   (1) — PROFILE_UPDATED
  MEDIUM (2) — TAX_UPDATED, CASHFLOW_UPDATED, PORTFOLIO_UPDATED, SIMULATION_UPDATED
  LOW    (3) — EXPLANATION_READY, AGENT_STARTED, AGENT_COMPLETED

Deduplication (coalescing):
  3x PROFILE_UPDATED for same session → merged into 1 entry
  payload shallow-merged; only updatedAt refreshed; no duplicate cascade

Queue behaviour:
  If cascade already running for session → new event enqueued (not dropped)
  After cascade ends → drain queue HIGH-first, then MEDIUM, then LOW
```

This prevents cascades from interleaving and from producing inconsistent intermediate states.

---

### Pattern 3 — Reactive Consistency (Full vs Partial Recompute)

When upstream data changes, downstream agents recompute automatically. The system, not the LLM, guarantees this.

**Recompute type decision table:**

| Event | Recompute Type | Agents Triggered | Reason |
|-------|---------------|-----------------|--------|
| `PROFILE_UPDATED` | **FULL** | simulation → portfolio → risk | Income/age change affects everything |
| `TAX_UPDATED` | **PARTIAL** | simulation only | Tax signals adjust effective savings rate |
| `CASHFLOW_UPDATED` | **PARTIAL** | simulation only | Spending changes monthly surplus |
| `SIMULATION_UPDATED` | **PARTIAL** | portfolio → risk | New gap affects allocation and score |
| `PORTFOLIO_UPDATED` | **PARTIAL** | risk only | Equity % change → risk score change |

```
PROFILE_UPDATED fires (FULL cascade)
         │
         ▼
ReactiveEngine._runCascade()
  ├── recomputeSimulation(state)    ← financial.calculator.js, ~1ms, no LLM
  │     → new projected_savings, savings_gap, milestones
  │     → StateManager.update({simulation})  _version++
  │     → Redis.updateSession({simulation})
  │     → emit SIMULATION_UPDATED → WebSocket push
  │
  ├── recomputePortfolio(state)     ← sees updated simulation
  │     computePortfolioAllocation(profile, newSimulation)
  │     → StateManager.update({portfolio})  _version++
  │     → Redis.updateSession({portfolio})
  │     → emit PORTFOLIO_UPDATED → WebSocket push
  │
  └── recomputeRisk(state)          ← sees updated simulation + portfolio
        computeRiskScore(profile, newPortfolio, newSimulation)
        → StateManager.update({risk})  _version++
        → Redis.updateSession({risk})
        → emit RISK_UPDATED → WebSocket push

Zero LLM calls. Zero manual triggers. Guaranteed consistency.
```

---

### Pattern 4 — Conflict Resolution

When the same field arrives from multiple sources, a deterministic resolver decides the winner.

**Source precedence (highest wins):**

| Source | Rank | Example |
|--------|------|---------|
| `document_extracted` | 4 | Income range from uploaded W-2 |
| `user_stated` | 3 | "My income is $80k" typed in chat |
| `inferred` | 2 | LLM extracted from vague message |
| `default` | 1 | System fallback values |

**Tie-breaking within same rank:**
1. Higher `confidence` score wins
2. More recent `timestamp` wins

```javascript
// ConflictResolver.resolveField("income", [
//   { value: 80000, source: "inferred",           confidence: 0.5, timestamp: T-60s },
//   { value: 95000, source: "document_extracted",  confidence: 1.0, timestamp: T-now }
// ])
// → { value: 95000, source: "document_extracted" }  ← document wins
```

**mergeProfiles** applies this field-by-field, returning a clean merged object. Used in ProfileAgent when a new upload provides additional data.

**scoreDataQuality** returns 0.0–1.0:
- -1/7 per missing field from full profile schema
- Extra -0.15 for each missing critical field (`income`, `retirement_age`)
- Score surfaced in `insight.confidence` on A2UI components

---

### Pattern 5 — A2UI v2 (Agent-to-UI Orchestration)

The server answers four questions per panel. The frontend renders what it is told.

| Question | Field | Who answers |
|----------|-------|-------------|
| **WHAT** to show | `type` | Planner (LLM) |
| **WHY** it is shown | `insight.reason` + `insight.summary` | Planner `panel_reason` → UIComposer |
| **HOW** to show it | `meta.priority`, `meta.layout`, `meta.behavior` | UIComposer registry |
| **WHEN** to refresh | `meta.trigger` | UIComposer registry |

**Loading state (skeleton panels):**

```
1. Planner decides → ui[] list with panel_reasons
2. composeLoadingState(plan) → A2UI components with loading:true, data:{}, confidence:0
   └─ Frontend renders skeletons immediately (no flicker)
3. Agents run (math first, then LLM narrative)
4. composeUI(plan, state) → A2UI components with loading:false, data:computed, version:N
   └─ Frontend replaces skeletons with real data (atomic swap by version)
```

**Full A2UI v2 component shape:**

```javascript
{
  id:      "simulation_chart-0",
  type:    "simulation_chart",
  loading: false,             // ← true during skeleton phase
  version: 14,               // ← _version at time of composition; client rejects stale
  data:    {                  // ← pre-fetched state slice, no extra fetch needed
    can_retire_at_target: true,
    projected_savings_at_retirement: 2865086,
    // ...
  },
  meta: {
    priority:    "high",
    layout:      "full_width",
    position:    0,
    trigger:     "SIMULATION_UPDATED",   // ← WS event that refreshes this panel
    stage:       "summary",
    behavior:    { expandOnLoad: true, interactive: true }
  },
  insight: {
    reason:     "User asked about retirement feasibility",  // WHY
    summary:    "On track — $2.86M projected vs $1.05M required",  // WHAT
    confidence: 0.9
  },
  actions: [
    { label: "Adjust retirement age", action: "EDIT_RETIREMENT_AGE" },
    { label: "Change savings rate",   action: "EDIT_SAVINGS_RATE"   }
  ]
}
```

---

### Pattern 6 — Enforcement Layer (Not Just Design)

Three enforcement mechanisms ensure the design guarantees hold at runtime — even if a developer introduces a bug.

#### StaleGuard (`backend/engine/stale.guard.js`)

When a higher-priority event arrives mid-cascade, the running cascade is aborted:

```
PORTFOLIO_UPDATED cascade running (computing risk)
PROFILE_UPDATED (HIGH) arrives
  → StaleGuard: abort() the running AbortController
  → ReactiveEngine detects signal.aborted before next compute step
  → PORTFOLIO_UPDATED cascade exits early
  → PROFILE_UPDATED starts immediately (FULL cascade)
```

Without StaleGuard, the engine would wait for the PORTFOLIO cascade to finish before starting the higher-priority PROFILE cascade — producing a stale intermediate risk score.

#### SchemaValidator (`backend/memory/schema.validator.js`)

Every `RedisMemory.updateSession()` call validates the patch before any write:

```
documentInsights.tax = { grossIncome: 145000 }  ← forbidden raw PII
  → SchemaValidator.validateSessionWrite() throws SchemaViolationError
  → Redis write blocked
  → Bug surfaces immediately at write time (not silently persisted)
```

The validator also checks that required abstracted fields are present:
- `documentInsights.tax` must have `income_range` (not raw income)
- `documentInsights.cashflow` must have `budget_health` and `savings_rate_label`

#### VectorStore Session Isolation (`backend/vector/vector.store.js`)

`queryForSession()` and `storeForSession()` throw immediately if `sessionId` is missing:

```javascript
// SAFE — throws if sessionId is falsy, empty, or not a string
const ragContext = await vectorStore.queryForSession(sessionId, message);

// UNSAFE (old API — still exists for backward compat but not used in routes)
const ragContext = await vectorStore.searchAsContext(message);  // no sessionId → cross-session leak
```

The throw-on-missing pattern surfaces the bug at the call site — not as a silent data leak.

---

## What Happens When You Ask "Can I retire at 55?"

### Step 1 — Route Layer

```
POST /api/chat { message: "Can I retire at 55?", sessionId: null }
  → New sessionId generated (UUID)
  → Load Redis session: {} (empty — first request)
  → reactiveEngine.seedFromSession(sessionId, {})
  → RAG context: "" (no prior history)
```

### Step 2 — Planner (LLM: intent classification only)

```
LLM classifies intent:
{
  intent: "Retirement feasibility check",
  agents: ["profile", "simulation", "explanation"],
  ui: [
    { type: "profile_summary",   panel_reason: "Profile needed to personalise projections" },
    { type: "simulation_chart",  panel_reason: "User asked about retirement feasibility" },
    { type: "explanation_panel", panel_reason: "Summarises findings in plain English" }
  ],
  confidence: "high"
}

composeLoadingState(plan) → 3 skeleton components sent to frontend immediately
```

### Step 3 — Profile (LLM: entity extraction)

```
LLM extracts from natural language:
{ age: 30, income: 80000, savings: 50000, retirement_age: 55, risk_tolerance: "medium" }

ConflictResolver.scoreDataQuality(profile) → 0.71 (missing goals, monthly_expenses)
StateManager.update({profile})  _version: 1
```

### Step 4 — Simulation (Math first, then LLM)

```
calculator.js (deterministic, ~1ms):
  projected_savings = 50000 × (1.07)^25 + 38000 × ((1.07)^25 - 1)/0.07
                    = $2,865,086  ← same number every run for same inputs

LLM (simulationChain, ~800ms):
  Receives pre-computed numbers. Writes: { summary, milestone_notes }
  Cannot change $2,865,086 — it's in the prompt as a literal

StateManager.update({simulation})  _version: 2
emit SIMULATION_UPDATED → WebSocket → Angular simulation chart renders
```

### Step 5 — Explanation (LLM: narrative synthesis)

```
Receives profile + simulation (pre-computed)
Returns: "Retiring at 55 is achievable. Your projected $2.86M far exceeds..."
emit EXPLANATION_READY → WebSocket
```

### Step 6 — Compose A2UI v2 + Persist

```
composeUI(plan, {profile, simulation, ...}) → richUI (version:2, loading:false)
Redis.updateSession({..., uiContext: richUI})
HTTP response: { sessionId, message, ui: richUI, data, trace }
```

---

## What Happens When You Upload a Tax Document

### Step 1 — Document Ingestion (trust-by-design)

```
POST /api/upload (W2.txt, in-memory buffer, NEVER on disk)
  LLM: classify → "tax_document" (high confidence)
  LLM: extract raw_values (ephemeral, local variable only):
    { grossIncome: 145000, effectiveTaxRate: 18.5, marginalRate: 22 }
  PII Sanitizer:
    145000 → income_range: "UPPER_MIDDLE"
    18.5%  → effective_rate: "18.5%"
  raw_values DISCARDED ← never reaches Redis/disk
  taxInsights = { income_range, tax_bracket, effective_rate, deductions_level }
```

### Step 2 — Conflict Resolution (profile merge)

```
Existing profile: { income: 80000, source: "user_stated" }
Document signals: { income_range: "UPPER_MIDDLE", source: "document_extracted" }

ConflictResolver.mergeProfiles(existingProfile, incomingData, "document_extracted")
  → document_extracted rank (4) > user_stated rank (3)
  → document-derived income range replaces inferred value
  → profile updated with higher-confidence data
```

### Step 3 — Routing (deterministic, not LLM)

```
ROUTING_MAP["tax_document"] → { agents: [profile, tax, simulation, explanation] }
No LLM involved in routing decision
```

### Step 4 — Pipeline runs, then PROFILE_UPDATED fires

```
PROFILE_UPDATED (priority: HIGH) → ReactiveEngine
  → FULL cascade: simulation → portfolio → risk (all ~3ms, zero LLM)
  → StateManager._version increments 3×
  → WebSocket pushes all three updates to Angular client
```

### Step 5 — A2UI v2 with tax panel

```
composeUI(syntheticPlan, state) →
  tax_panel:         { data: tax,        insight: { summary: "22% bracket — 7/10 efficiency" } }
  simulation_chart:  { data: simulation, insight: { summary: "On track — $2.86M projected" } }
  explanation_panel: { data: {},         insight: { summary: "Personalised financial analysis" } }
```

---

## The LLM Boundary

### LLM CAN

```
✅ Classify intent → "user wants retirement projection"
✅ Extract profile from text → { age: 35, income: 80000 }
✅ Write narrative summary (using pre-computed numbers)
✅ Write portfolio rationale (using pre-computed allocation)
✅ Write risk factor descriptions (using pre-computed score)
✅ Suggest tax optimization strategies (using abstracted signals)
✅ Write final explanation referencing computed state
```

### LLM CANNOT

```
❌ Compute savings projections       → financial.calculator.js does this
❌ Decide allocation percentages     → portfolio.compute.js does this
❌ Set risk score                    → risk.compute.js does this
❌ Calculate stress test amounts     → risk.compute.js does this
❌ Trigger or skip recomputation     → ReactiveEngine dependency map does this
❌ Resolve conflicting data          → ConflictResolver precedence rules do this
❌ Decide UI layout or priority      → UIComposer component registry does this
❌ Store or access raw PII           → PII sanitizer runs before any chain invocation
```

**Why this matters:** If the LLM hallucinates, you get a poorly worded sentence. You never get a wrong projected savings number — because the LLM never computed it.

---

## Failure Handling

| Failure | Behaviour |
|---------|-----------|
| Redis down | StateManager in-process Map used; session still works for duration of process |
| LLM API timeout | `withFallback()` in every LangGraph node; simulation still returns deterministic numbers |
| Cascade error | try/catch in `_runCascade`; error logged; queued events still drain |
| Higher-priority event mid-cascade | StaleGuard aborts running cascade; fresh cascade starts immediately |
| Forbidden PII in Redis patch | SchemaValidator throws `SchemaViolationError`; write blocked, not silently stored |
| Missing sessionId in vector query | `queryForSession()` throws immediately; surfaces bug at call site |
| Document too large | multer 5 MB limit rejects before ingestion; 400 returned |
| PII sanitizer fails | Default safe values used; abstraction step never skipped |
| Agent chain fails | `SAFE_DEFAULT_PLAN` used by planner; explanation agent has hardcoded fallback text |

---

## Reactive Event Flow (WebSocket)

```
POST /api/chat
  [0ms]    → composeLoadingState(plan) → skeleton panels sent (if implemented on client)
  [1200ms] → PLANNER_DECIDED            — UI knows which panels to prepare
  [1200ms] → PROFILE_UPDATED (HIGH)     — priority queue receives event
  [1201ms] → ReactiveEngine: FULL cascade starts
  [1203ms] → SIMULATION_UPDATED         — chart renders with real data
  [1204ms] → PORTFOLIO_UPDATED          — portfolio renders
  [1205ms] → RISK_UPDATED               — risk panel renders
  [2100ms] → EXPLANATION_READY          — chat message appears
  [2200ms] → HTTP response              — full A2UI v2 (version:N) as backup source

Users see panels populate progressively. Each A2UI component checks version before render.
```

---

## Dependency Graph

```javascript
// reactive.engine.js — hardcoded, never changes at runtime
const DEPENDENCY_MAP = {
  PROFILE_UPDATED:    ['simulation', 'portfolio', 'risk'],  // FULL
  TAX_UPDATED:        ['simulation'],                        // PARTIAL
  CASHFLOW_UPDATED:   ['simulation'],                        // PARTIAL
  SIMULATION_UPDATED: ['portfolio', 'risk'],                 // PARTIAL
  PORTFOLIO_UPDATED:  ['risk'],                              // PARTIAL
}
```

| Question | Answer | Mechanism |
|----------|--------|-----------|
| If income changes, does simulation ALWAYS rerun? | **Yes** | PROFILE_UPDATED → ReactiveEngine → recomputeSimulation() |
| What if two events arrive simultaneously? | **Coalesced** | PriorityQueue deduplicates by (event, sessionId) |
| Who resolves conflicting data from document vs chat? | **ConflictResolver** | document_extracted rank (4) beats user_stated (3) |
| Can the UI show stale data? | **No** | `version` field on each A2UI component; client rejects version < lastSeen |
| Who guarantees recomputation — system or LLM? | **System** | ReactiveEngine dependency map, hardcoded in JS |
