# Agent Reference — AI Financial Planner

> Version: v3 — Hybrid deterministic compute + LLM narrative + conflict resolution + priority events

---

## Agent Contract

Every agent that touches financial data follows this contract:

```javascript
// Pure compute step (deterministic, no LLM)
computeResult = computeFn(state)   // same input → same numbers, always

// Narrative step (LLM, text only)
narrative = await llmChain.invoke({ ...computeResult, ...contextForLLM })

// Final output
return { ...computeResult, ...narrative }
```

**Rules enforced across all compute agents:**
- No randomness in the compute step
- No LLM inside financial calculations
- No chat history dependency in compute
- LLM receives pre-computed numbers — it cannot change them

---

## Architecture Overview

```
User Message / Document Upload
         │
         ▼
PlannerAgent ──── intent + UI decisions only (LLM)
         │
         ▼  (conditional: plan.agents[] drives execution)
ProfileAgent ──── entity extraction (LLM)
         │
         ├──► TaxAgent    ──── pure-fn signals → LLM strategy text
         ├──► CashflowAgent ── pure-fn signals → LLM recommendation text
         │
         ▼
SimulationAgent ── calculator.js (math) → LLM summary text
         │
         ▼
PortfolioAgent ─── portfolio.compute.js (math) → LLM rationale text
         │
         ▼
RiskAgent ──────── risk.compute.js (math) → LLM factor text
         │
         ▼
ExplanationAgent ── LLM synthesises all computed state → plain text

         ── (parallel, event-driven) ──────────────────────────────────
ReactiveEngine ─── recomputes simulation/portfolio/risk deterministically
                   when PROFILE_UPDATED / TAX_UPDATED / etc fires
                   ZERO LLM calls in reactive path
```

---

## 1. PlannerAgent

**File**: `backend/agents/planner.agent.js`
**LangGraph node**: `node_planner`
**Skipped when**: plan is pre-seeded by upload route

### Restricted Role

The planner is an **intent classifier**, not an orchestrator. It answers two questions only:

1. What does the user want? (intent)
2. Which UI panels should render?

It does NOT:
- Trigger or prevent recomputation
- Execute financial logic
- Decide whether simulation is "fresh enough"

### Input

```json
{
  "message": "Can I retire at 55?",
  "context": "<conversation history>",
  "profileExists": "yes",
  "simulationExists": "no"
}
```

### Output

```json
{
  "intent": "Retirement feasibility check at age 55",
  "required_agents": ["profile", "simulation", "explanation"],
  "optional_agents": ["portfolio"],
  "missing_data": ["tax_document"],
  "confidence": "high",
  "decision_rationale": "Included simulation because user asked about retirement timeline.",
  "agents": ["profile", "simulation", "explanation"],
  "ui": [
    { "type": "profile_summary",   "panel_reason": "Profile needed to personalise projections" },
    { "type": "simulation_chart",  "panel_reason": "User asked about retirement feasibility" },
    { "type": "explanation_panel", "panel_reason": "Summarises all findings in plain English" }
  ]
}
```

The `panel_reason` fields are passed to the UIComposer which embeds them as `insight.reason` in each A2UI v2 component, so the frontend can show "Why am I seeing this?" per panel.

### What the planner does NOT output

The planner never outputs layout, priority, trigger events, or data slices. Those are all determined deterministically by `ui.composer.js`. The planner's only UI contribution is: *which panels* and *why*.

### Guardrails (enforced in code, not by LLM)

| Rule | Code location |
|------|--------------|
| `explanation` always present | `planner.agent.js` post-processes LLM output |
| `portfolio` requires `simulation` | `planner.agent.js` injects `simulation` if missing |
| `risk` requires `portfolio` → `simulation` | `planner.agent.js` injects both |
| Chain failure → `SAFE_DEFAULT_PLAN` | try/catch in `planner.agent.js` |

### SAFE_DEFAULT_PLAN (fallback on chain failure)

```javascript
{ agents: ['profile', 'simulation', 'explanation'], confidence: 'low', ... }
```

---

## 2. ProfileAgent

**File**: `backend/agents/profile.agent.js`
**LangGraph node**: `node_profile`

### Role

Extracts structured profile from natural language using LLM entity recognition. Runs on every request (unless `profileExists` is true and planner skips it).

### Input

- User message (natural language)
- Session memory (markdown)
- RAG context (ChromaDB)

### Output

```json
{
  "name": "Alex",
  "age": 35,
  "income": 80000,
  "savings": 200000,
  "monthly_expenses": 3500,
  "retirement_age": 65,
  "risk_tolerance": "medium",
  "goals": ["retire_early", "buy_home"]
}
```

### Note on PII

Profile numeric fields (`income`, `savings`, `monthly_expenses`) are used in-session for deterministic computation. They are held in the session Redis key. These are user-provided values, not extracted from uploaded documents (which are abstracted to range labels by DocumentIngestionAgent).

### Conflict Resolution

When an existing profile is updated (new chat message or document upload), the ProfileAgent uses `ConflictResolver.mergeProfiles()` to resolve field-level conflicts:

```
Existing: { income: 80000, source: "user_stated" }
Incoming: { income_range: "UPPER_MIDDLE", source: "document_extracted" }

ConflictResolver:
  document_extracted rank (4) > user_stated rank (3)
  → document-derived data wins
  → profile updated with higher-authority value

ConflictResolver.scoreDataQuality(mergedProfile) → 0.0–1.0
  → surfaced as insight.confidence on A2UI panels
```

After profile merge, `PROFILE_UPDATED` (priority: HIGH) fires → ReactiveEngine FULL cascade.

---

## 3. SimulationAgent

**File**: `backend/agents/simulation.agent.js`
**LangGraph node**: `node_simulation`
**Compute module**: `backend/utils/financial.calculator.js`

### Hybrid Pipeline

```
Step 1 — Deterministic math (financial.calculator.js)
  calculateRetirementProjection(profile)
  → FV = PV × (1+r)^n + PMT × [((1+r)^n − 1) / r]
  → required_savings = annual_expenses × 25  (4% SWR rule)
  → All numbers: projected_savings, savings_gap, milestones, years_of_runway

Step 2 — LLM narrative (simulationChain)
  Receives: pre-computed numbers (cannot change them)
  Returns: { summary: "2-3 sentences", milestone_notes: ["note1", "note2", "note3"] }
```

### Input

- `profile` (from ProfileAgent or DEFAULT_PROFILE)
- `message` (for narrative context)
- `ragContext`

### Output

```json
{
  "can_retire_at_target": true,
  "projected_savings_at_retirement": 1203847,
  "required_savings_at_retirement": 1050000,
  "savings_gap": 0,
  "monthly_shortfall_or_surplus": 643,
  "years_of_runway": 28,
  "milestones": [
    { "year": 2035, "savings": 480000, "note": "Emergency fund and first major investment milestone." },
    { "year": 2044, "savings": 840000, "note": "Portfolio reaches critical mass for compounding." },
    { "year": 2054, "savings": 1203847, "note": "Retirement target achieved." }
  ],
  "summary": "You are on track to retire at 65 with $1.2M...",
  "assumptions": {
    "annual_return": "7%",
    "withdrawal_rule": "4% SWR (25x rule)",
    "monthly_savings": 2833,
    "annual_savings": 34000
  }
}
```

### LLM failure fallback

If LLM fails, summary is constructed from the calculated numbers directly — simulation still returns valid data.

---

## 4. PortfolioAgent

**File**: `backend/agents/portfolio.agent.js`
**LangGraph node**: `node_portfolio`
**Compute module**: `backend/agents/compute/portfolio.compute.js`

### Hybrid Pipeline

```
Step 1 — Deterministic allocation (portfolio.compute.js)
  Input: profile.risk_tolerance, profile.age, profile.retirement_age

  Base allocation (from risk_tolerance):
    low    → 30% equities / 55% bonds / 5% real estate / 10% cash
    medium → 60% equities / 30% bonds / 5% real estate / 5% cash
    high   → 80% equities / 12% bonds / 5% real estate / 3% cash

  Glide path (applied automatically):
    years ≤ 10 → shift −10% equities to bonds  (mid-glide)
    years ≤ 5  → shift −20% equities to bonds  (near-retirement)

  expected_return = (equity/100 × 9%) + ((1−equity/100) × 3%)
  rebalance = quarterly (≤5 yrs) | annually

Step 2 — LLM rationale (portfolioRationaleChain)
  Receives: pre-computed allocation (cannot change percentages)
  Returns: 2-3 sentence rationale text string
```

### Output

```json
{
  "allocation": [
    { "asset": "Equities",    "percent": 60 },
    { "asset": "Bonds",       "percent": 30 },
    { "asset": "Real Estate", "percent": 5  },
    { "asset": "Cash",        "percent": 5  }
  ],
  "strategy": "balanced",
  "expected_annual_return_percent": 6.6,
  "rebalance_frequency": "annually",
  "rationale": "With 30 years to retirement and medium risk tolerance, a balanced 60/30 split gives you strong growth potential while bonds provide stability..."
}
```

---

## 5. RiskAgent

**File**: `backend/agents/risk.agent.js`
**LangGraph node**: `node_risk`
**Compute module**: `backend/agents/compute/risk.compute.js`

### Hybrid Pipeline

```
Step 1 — Deterministic scoring (risk.compute.js)
  Factors (each 0–3):
    equityRisk = equity% ≥75→3, ≥55→2, else 1                  (weight ×2)
    timeRisk   = years ≤5→3, ≤10→2, ≤20→1, else 0              (weight ×2)
    gapRisk    = gap ≥$500k→3, ≥$100k→2, >$0→1, else 0         (weight ×3)

  score = round( (equity×2 + time×2 + gap×3) / 21 × 10 )      → 1–10
  risk_level: 1-3=low, 4-5=medium, 6-7=high, 8-10=very high

  Stress tests (deterministic):
    market_crash_20pct_impact = -(projected_savings × equity% × 0.20)
    inflation_spike_impact    = -(projected_savings × 0.05)

Step 2 — LLM narrative (riskNarrativeChain)
  Receives: pre-computed score + inputs (cannot change score)
  Returns: { factors[{factor, impact, description}], mitigation_steps[] }
```

### Input

- `profile`, `portfolio`, `simulation`

### Output

```json
{
  "overall_risk_score": 5,
  "risk_level": "medium",
  "stress_test": {
    "market_crash_20pct_impact": -144462,
    "inflation_spike_impact": -60192
  },
  "factors": [
    {
      "factor": "Equity Concentration",
      "impact": "medium",
      "description": "60% equities provides growth but exposes the portfolio to market swings."
    },
    {
      "factor": "Time Horizon",
      "impact": "low",
      "description": "30 years to retirement provides significant time to recover from downturns."
    }
  ],
  "mitigation_steps": [
    "Rebalance annually to maintain target allocation.",
    "Consider shifting 5% from equities to bonds as you enter your 50s."
  ]
}
```

---

## 6. TaxAgent

**File**: `backend/agents/tax.agent.js`
**LangGraph node**: `node_tax`
**Skipped when**: `taxInsights` is null in graph state

### Pipeline

```
Step 1 — parseTaxSignals()         pure function: validate + normalize signals
Step 2 — analyzeDeductions()       pure function: score 1–4, flag deduction gap
Step 3 — taxChain (LLM)            LLM: generate optimization strategies
Step 4 — rankOptimizationStrategies() pure function: sort by priority, boost gap strategies
```

The LLM generates strategy text. Code ranks and filters it.

### Input

- `taxInsights` (abstracted signals from document upload, never raw PII)
- `profile`, `simulation`

### Output

```json
{
  "tax_efficiency_score": 7,
  "tax_bracket": "22%",
  "effective_rate": "18.5%",
  "income_range": "UPPER_MIDDLE",
  "deductions_level": "MODERATE",
  "optimization_strategies": [
    { "strategy": "Maximize 401(k) contributions", "priority": "high", "rationale": "..." }
  ],
  "retirement_tax_impact": "...",
  "key_insight": "...",
  "disclaimer": "Tax analysis based on abstracted signals. Consult a qualified tax advisor."
}
```

---

## 7. CashflowAgent

**File**: `backend/agents/cashflow.agent.js`
**LangGraph node**: `node_cashflow`
**Skipped when**: `cashflowInsights` is null in graph state

### Pipeline

```
Step 1 — parseCashflowSignals()    pure function: validate + normalize
Step 2 — classifySpendingRisk()    pure function: spending level → risk label (low/medium/high/critical)
Step 3 — cashflowChain (LLM)       LLM: generate recommendations
Step 4 — deriveSavingsInsight()    pure function: savings score 1–5, acceleration potential
```

### Input

- `cashflowInsights` (abstracted signals from document upload, never raw transactions)
- `profile`

### Output

```json
{
  "budget_health": "good",
  "savings_rate_label": "MODERATE",
  "spending_level": "ELEVATED",
  "spending_risk": { "risk": "medium", "requires_intervention": false },
  "monthly_surplus_indicator": "positive",
  "top_spending_categories": ["Housing", "Food", "Transport"],
  "recommendations": [
    { "action": "Reduce dining out", "priority": "medium", "impact_on_retirement": "..." }
  ],
  "savings_insight": { "score": 3, "acceleration_potential": "MODERATE" },
  "disclaimer": "Analysis based on abstracted spending signals. No transaction data was stored."
}
```

---

## 8. DocumentIngestionAgent

**File**: `backend/agents/document.ingestion.agent.js`
**Trigger**: POST /api/upload only

### Pipeline

```
Raw document text (in-memory buffer, NEVER written to disk)
        │
        ▼
LLM: classify document type + extract raw_values (ephemeral, in-memory only)
        │
  raw_values (exist for < 1ms, never stored):
  { grossIncome: 148500, effectiveTaxRate: 18.5, marginalRate: 22 }
        │
        ▼
PII Sanitizer (pii.sanitizer.js):
  grossIncome: 148500 → income_range: "UPPER_MIDDLE"
  effectiveTaxRate: 18.5 → effective_rate: "18.5%"
  raw_values → DISCARDED
        │
        ▼
routeDocument(docType) → { agents[], ui[], insightKey }
  (lookup in ROUTING_MAP — deterministic, not LLM)
        │
        ▼
Output: abstracted signals only (pii_stored: false, raw_document_stored: false)
```

### Document Type Routing

| Type | Agents routed | Insight stored |
|------|--------------|----------------|
| `tax_document` | profile, tax, simulation, explanation | `documentInsights.tax` |
| `bank_statement` | profile, cashflow, simulation, explanation | `documentInsights.cashflow` |
| `investment_statement` | profile, portfolio, risk, simulation, explanation | `documentInsights.portfolio` |
| `debt_document` | profile, simulation, cashflow, explanation | `documentInsights.debt` |
| `unknown` | profile, simulation, explanation | — |

---

## 9. ExplanationAgent

**File**: `backend/agents/explanation.agent.js`
**LangGraph node**: `node_explanation`
**Always runs** — final node in every pipeline

### Role

Synthesises all computed state into a human-readable narrative that directly answers the user's original question. Receives pre-computed numbers — writes text only.

### Input

- `profile`, `simulation`, `portfolio`, `risk` (all pre-computed)
- `message` (user's original question)

### Output

Plain text (3–5 sentences), e.g.:

> "Based on your profile, you are on track to retire at 65 with $1.2M in projected savings — a $150k surplus above the 25× rule target. Your balanced 60/30 allocation carries a medium risk score of 5/10, with stress tests showing a $144k exposure to a 20% market crash. To accelerate your timeline by 2–3 years, consider increasing monthly contributions by $400 and adopting your mid-glide rebalance at age 55."

---

## Agent Invocation Matrix

| User Intent | Agents Invoked |
|-------------|---------------|
| "Can I retire at 55?" | profile, simulation, explanation |
| "Show my investment allocation" | profile, simulation, portfolio, risk, explanation |
| "Review my tax return" | profile, tax, simulation, explanation |
| "Analyze my bank statement" | profile, cashflow, simulation, explanation |
| "Am I taking too much risk?" | profile, simulation, portfolio, risk, explanation |
| Full financial review | All 7 agents |

---

## ReactiveEngine — Automatic Recomputation (v3)

The ReactiveEngine listens for domain events and re-runs compute functions without any LLM involvement.

### Recompute type decision table

| Event | Priority | Recompute Type | Downstream Agents |
|-------|----------|---------------|-------------------|
| `PROFILE_UPDATED` | HIGH (1) | **FULL** | simulation, portfolio, risk |
| `TAX_UPDATED` | MEDIUM (2) | PARTIAL | simulation only |
| `CASHFLOW_UPDATED` | MEDIUM (2) | PARTIAL | simulation only |
| `SIMULATION_UPDATED` | MEDIUM (2) | PARTIAL | portfolio, risk |
| `PORTFOLIO_UPDATED` | MEDIUM (2) | PARTIAL | risk only |

### Cascade behaviour

```javascript
// If cascade already running for session → event enqueued (not dropped)
if (_pendingCascades.has(sessionId)) {
  _queue.enqueue(event, sessionId, payload, priority)  // coalesced if duplicate
  return
}

// Run cascade, then drain queued events for this session (HIGH-first)
_pendingCascades.set(sessionId, event)
await _cascade(sessionId, event, downstream, recomputeType)
const queued = _queue.drain().filter(e => e.sessionId === sessionId)
for (item of queued) await _cascade(...)
_pendingCascades.delete(sessionId)
```

When a cascade runs:
1. Compute functions execute sequentially (each sees updated upstream state)
2. `StateManager._version` increments on every agent recompute
3. Results written to StateManager (in-process) AND Redis (durable)
4. Domain events emitted per recomputed agent → WebSocket push to client
5. Existing LLM narrative (rationale, factor descriptions) is **preserved** — not regenerated

**Zero LLM calls in any reactive cascade.**
