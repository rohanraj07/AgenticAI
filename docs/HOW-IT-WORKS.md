# How It Works — AI Financial Planner

> "A state-driven deterministic financial system with an AI interface."

---

## The Core Idea

Most AI financial tools are LLM-driven — the AI decides everything, including the numbers. This system is different:

```
WRONG approach (LLM-driven):
  User: "Can I retire at 55?"
  LLM: "Sure, with $500k you'll need $200k/yr, let me calculate... you need $5M."
  ← LLM invented those numbers. They change every run. They may be wrong.

THIS system (state-driven):
  User: "Can I retire at 55?"
  calculator.js: FV = $200k × (1.07)^20 + $34k × ((1.07)^20 - 1)/0.07 = $1,203,847
  LLM: "Based on your projected $1,203,847 in savings..."
  ← Numbers are deterministic. LLM only writes the sentence around them.
```

**The LLM is the interface. Math is the engine.**

---

## The Three Patterns

### Pattern 1 — State-Driven Execution

The system maintains a **single source of truth** per session:

```javascript
state = {
  profile:    { age: 35, income: 80000, savings: 200000, ... },
  simulation: { projected_savings: 1203847, can_retire: true, ... },
  portfolio:  { allocation: [{Equities:60},{Bonds:30},...], strategy: "balanced", ... },
  risk:       { overall_risk_score: 5, risk_level: "medium", ... },
  tax:        { tax_efficiency_score: 7, optimization_strategies: [...], ... },
  cashflow:   { budget_health: "good", recommendations: [...], ... }
}
```

All agents read from this state. All agents write back to it. There is no other truth.

This state lives in:
- **StateManager** — in-process (ReactiveEngine uses this for instant access)
- **Redis** — durable (persists across requests, TTL 1 hour)
- **Markdown** — human-readable (injected into LLM prompts as context)

---

### Pattern 2 — Reactive Consistency

When any upstream value changes, downstream agents **automatically recompute**. The system, not the LLM, guarantees this.

```
PROFILE_UPDATED fires (e.g. user shares new income)
         │
         ▼
ReactiveEngine reads dependency map:
  PROFILE_UPDATED → [simulation, portfolio, risk]
         │
         ├── recomputeSimulation(state)
         │     calculateRetirementProjection(newProfile)
         │     → new projected_savings, savings_gap, milestones
         │     → StateManager updated, Redis updated, SIMULATION_UPDATED emitted
         │
         ├── recomputePortfolio(state)          ← sees updated simulation
         │     computePortfolioAllocation(newProfile, newSimulation)
         │     → new allocation, strategy, expected_return
         │     → StateManager updated, Redis updated, PORTFOLIO_UPDATED emitted
         │
         └── recomputeRisk(state)               ← sees updated simulation + portfolio
               computeRiskScore(newProfile, newPortfolio, newSimulation)
               → new score, risk_level, stress_tests
               → StateManager updated, Redis updated, RISK_UPDATED emitted
```

**Zero LLM calls. Zero manual triggers. Guaranteed consistency.**

This answers the critical question: "If income changes, can you guarantee simulation reruns?"
**Yes — it is enforced by code in `reactive.engine.js`, not by any prompt.**

---

### Pattern 3 — A2UI v2 (Agent-to-UI Orchestration)

The server answers four questions for every UI panel. The frontend renders what it is told.

| Question | Answered by |
|----------|------------|
| **WHAT** to show | Planner (LLM intent classification) |
| **WHY** it is shown | Planner `panel_reason` → UIComposer `insight.reason` |
| **HOW** to show it | UIComposer: `layout`, `priority`, `expandOnLoad`, `interactive` |
| **WHEN** to refresh | UIComposer: `trigger` (WebSocket event name) |

```
Planner LLM output:
  plan.ui = [
    { type: "simulation_chart", panel_reason: "User asked about retirement feasibility" },
    { type: "tax_panel",        panel_reason: "Tax document signals detected" }
  ]
         │
UIComposer (deterministic — no LLM):
  composeUI(plan, state) →
  [
    {
      id: "simulation_chart-0",
      type: "simulation_chart",
      data: { can_retire_at_target: true, projected_savings: 2865086, ... },
      meta: { priority: "high", layout: "full_width", trigger: "SIMULATION_UPDATED",
              behavior: { expandOnLoad: true, interactive: true } },
      insight: { reason: "User asked about retirement feasibility",
                 summary: "On track — $2.86M projected vs $1.05M required",
                 confidence: 0.9 },
      actions: [{ label: "Adjust retirement age", action: "EDIT_RETIREMENT_AGE" }]
    },
    {
      id: "tax_panel-1",
      type: "tax_panel",
      data: { tax_efficiency_score: 7, tax_bracket: "22%", ... },
      meta: { priority: "high", layout: "full_width", trigger: "TAX_UPDATED",
              behavior: { expandOnLoad: true, interactive: false } },
      insight: { reason: "Tax document signals detected",
                 summary: "22% bracket — efficiency 7/10, 3 strategies identified",
                 confidence: 0.85 },
      actions: [{ label: "View all strategies", action: "EXPAND_TAX_STRATEGIES" }]
    }
  ]
         │
Angular DynamicRendererComponent:
  renders each comp using comp.data (pre-fetched, no re-fetch needed)
  shows comp.insight.reason as "Why am I seeing this?" per panel
  uiContext persisted to Redis — survives page refresh
```

**Different users see different UI. New panels, layouts, and actions are server-side changes only — zero frontend deploys.**

---

## What Happens When You Ask "Can I retire at 55?"

### Step 1 — Route Layer

```
POST /api/chat { message: "Can I retire at 55?", sessionId: null }
  → New sessionId generated
  → Load Redis session: {} (empty)
  → reactiveEngine.seedFromSession(sessionId, {})
  → RAG context: "" (no prior history)
```

### Step 2 — Planner (LLM: intent classification only)

```
Input: message + sessionContext + { profileExists: false, simulationExists: false }

LLM output:
{
  intent: "Retirement feasibility check",
  agents: ["profile", "simulation", "explanation"],
  ui: [profile_summary, simulation_chart, explanation_panel],
  confidence: "high"
}
```

The planner classifies intent. It does not calculate anything.

### Step 3 — Profile (LLM: entity extraction)

```
LLM extracts from natural language:
{ age: 30, income: 80000, savings: 50000, retirement_age: 55, risk_tolerance: "medium" }
```

### Step 4 — Simulation (Math first, then LLM)

```
calculator.js (deterministic):
  years_to_retirement = 55 - 30 = 25
  monthly_savings = (80000/12) - 3500 = $3,167/mo
  annual_savings = $38,000/yr

  projected_savings = 50000 × (1.07)^25 + 38000 × ((1.07)^25 - 1)/0.07
                    = $271,372 + $2,593,714 = $2,865,086  ← deterministic number

  required_savings = 3500 × 12 × 25 = $1,050,000  (25x rule)
  can_retire = true (projected > required)
  monthly_surplus = ($2,865,086 × 4%) / 12 - $3,500 = $6,050/mo

LLM (simulationChain):
  Receives: pre-computed numbers
  Returns: { summary: "You are well on track...", milestone_notes: [...] }
           ← cannot change $2,865,086 or any other number
```

### Step 5 — Explanation (LLM: narrative synthesis)

```
Receives: profile + simulation (computed)
Returns: "Based on your current income of $80k and $50k in savings,
          retiring at 55 is achievable. Your projected $2.86M far exceeds
          the $1.05M required..."
```

### Step 6 — Persist + Emit

```
Redis: { profile, simulation, messages }
StateManager: { profile, simulation }
PROFILE_UPDATED → ReactiveEngine (no recompute needed — simulation already ran)
SIMULATION_UPDATED → WebSocket → Angular updates simulation chart
```

---

## What Happens When You Upload a Tax Document

### Step 1 — Document Ingestion (trust-by-design)

```
POST /api/upload (W2.txt in-memory buffer, never on disk)
  │
  ▼
DocumentIngestionAgent:
  LLM classifies: "tax_document" (high confidence)
  LLM extracts raw_values (ephemeral, in-memory only):
    { grossIncome: 145000, effectiveTaxRate: 18.5, marginalRate: 22 }
  PII Sanitizer:
    145000 → income_range: "UPPER_MIDDLE"
    18.5%  → effective_rate: "18.5%"
  raw_values DISCARDED ← never stored anywhere
  taxInsights = { income_range, tax_bracket, effective_rate, deductions_level }
```

### Step 2 — Routing (deterministic, not LLM)

```
routeDocument("tax_document")
  → { agents: [profile, tax, simulation, explanation], ui: [...] }
  ← ROUTING_MAP lookup, no LLM involved
```

### Step 3 — Pipeline (planner skipped — plan pre-seeded)

```
node_profile   → profile extracted from document context
node_tax       → tax analysis from taxInsights (22% bracket, MODERATE deductions)
               sub-agents: parseTaxSignals → analyzeDeductions (pure fn)
                           → taxChain (LLM: strategy text) → rankStrategies (pure fn)
node_simulation → calculator.js projection with real profile
node_explanation → narrative referencing all computed state
```

### Step 4 — Session updated

```
Redis: { profile, simulation, tax, documentInsights: { tax: taxInsights } }
StateManager: seeded with full session state
```

### Step 5 — Follow-up chat "Tell me more about my taxes"

```
Redis loads session → taxInsights available
Planner: "tax" in agents
node_tax: re-runs with persisted taxInsights
No document re-upload needed
```

---

## The LLM Boundary (What the LLM Can and Cannot Do)

### LLM CAN

```
✅ Classify intent: "user wants retirement projection"
✅ Extract profile from text: "age: 35, income: 80000"
✅ Write narrative summary (using pre-computed numbers)
✅ Write portfolio rationale (using pre-computed allocation)
✅ Write risk factor descriptions (using pre-computed score)
✅ Suggest tax optimization strategies (using abstracted signals)
✅ Write final explanation
```

### LLM CANNOT

```
❌ Compute savings projections     → financial.calculator.js does this
❌ Decide allocation percentages   → portfolio.compute.js does this
❌ Set risk score                  → risk.compute.js does this
❌ Calculate stress test amounts   → risk.compute.js does this
❌ Trigger recomputation           → ReactiveEngine dependency map does this
❌ Skip required agent steps       → LangGraph routing + guardrails prevent this
❌ Access or store raw PII         → PII sanitizer runs before any chain invocation
```

**Why this matters:** If the LLM hallucinates, you get a poorly worded sentence. You never get a wrong projected savings number — because the LLM never computed it.

---

## Dependency Graph — The Heart of the System

```javascript
// reactive.engine.js — hardcoded, never changes at runtime
const DEPENDENCY_MAP = {
  PROFILE_UPDATED:    ['simulation', 'portfolio', 'risk'],
  TAX_UPDATED:        ['simulation'],
  CASHFLOW_UPDATED:   ['simulation'],
  SIMULATION_UPDATED: ['portfolio', 'risk'],
  PORTFOLIO_UPDATED:  ['risk'],
}
```

Answering the design review questions:

| Question | Answer | Mechanism |
|----------|--------|-----------|
| If income changes, does simulation ALWAYS rerun? | **Yes** | PROFILE_UPDATED → ReactiveEngine → recomputeSimulation() |
| Where is the single source of truth? | **StateManager + Redis** | state = { profile, simulation, portfolio, risk, tax, cashflow } |
| What prevents LLM from skipping steps? | **LangGraph routing + guardrails** | Pure code, not prompts |
| Can two runs produce different numbers? | **No** | Compute functions are pure, same input → same output |
| Who guarantees recomputation — system or LLM? | **System** | ReactiveEngine listens for events, not LLM instructions |

---

## Trust-by-Design — What "Never Stored" Actually Means

The claim "raw PII is never stored" is enforced architecturally, not by policy:

```
1. multer.memoryStorage() — file NEVER touches disk (Node.js in-memory buffer only)
2. DocumentIngestionAgent — raw_values exist only in a local variable, discarded in same function call
3. PII sanitizer runs synchronously before any async operation
4. Abstracted signals are the ONLY thing passed to Redis.updateSession()
5. LangGraph state channels never contain raw_values (they're stripped before graph.invoke())
```

The system cannot store raw PII even if a developer wanted to — the pipeline doesn't expose a path for it.

---

## Reactive Event Flow (WebSocket)

As each agent completes, events push to the Angular UI in real time:

```
POST /api/chat
  [0ms]    AGENT_STARTED:planner
  [1200ms] PLANNER_DECIDED         → UI knows which panels to prepare
  [1200ms] AGENT_STARTED:profile
  [2100ms] PROFILE_UPDATED         → Profile panel renders
  [2100ms] AGENT_STARTED:simulation
  [2200ms] (ReactiveEngine also triggers — recomputes in background)
  [3300ms] SIMULATION_UPDATED      → Simulation chart renders
  [3300ms] AGENT_STARTED:explanation
  [4100ms] EXPLANATION_READY       → Chat message appears

HTTP response arrives at [4200ms] with full data as backup source.
```

Users see panels appear progressively rather than waiting 4+ seconds for everything.
