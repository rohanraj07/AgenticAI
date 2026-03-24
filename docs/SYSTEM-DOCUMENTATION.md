# AI Financial Planner — System Documentation

> **Audience**: Engineers, architects, and operators who need to understand, debug, extend, or operate the system.
> **Version**: Post-refactor v2 (hybrid deterministic + LLM, ReactiveEngine, pure-function compute)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture (Detailed)](#2-architecture-detailed)
3. [Agent Catalog](#3-agent-catalog)
4. [Orchestration Logic](#4-orchestration-logic)
5. [Memory & Data Model](#5-memory--data-model)
6. [Session Management](#6-session-management)
7. [Multi-Modal Ingestion](#7-multi-modal-ingestion)
8. [PII & Trust Model](#8-pii--trust-model)
9. [Failure & Fallback Strategy](#9-failure--fallback-strategy)
10. [Debugging & Observability](#10-debugging--observability)
11. [Operational Playbook](#11-operational-playbook)
12. [Sample End-to-End Flows](#12-sample-end-to-end-flows)
13. [WebSocket Role](#13-websocket-role)
14. [LLM vs Deterministic — Full Agent Map](#14-llm-vs-deterministic--full-agent-map)
15. [PII Enforcement Fix](#15-pii-enforcement-fix)
16. [Session Atomicity & Concurrency](#16-session-atomicity--concurrency)
17. [Vector DB Isolation Guarantees](#17-vector-db-isolation-guarantees)
18. [Planner Decision Deep Dive](#18-planner-decision-deep-dive)
19. [Data Lifecycle & Retention](#19-data-lifecycle--retention)
20. [Trust Boundaries](#20-trust-boundaries)
21. [Concurrency & Event Ordering](#21-concurrency--event-ordering)
22. [Hybrid Compute Layer (ReactiveEngine + StateManager)](#22-hybrid-compute-layer-reactiveengine--statemanager)
23. [Pure-Function Compute Modules](#23-pure-function-compute-modules)
24. [A2UI v2 — Agent-to-UI Orchestration](#24-a2ui-v2--agent-to-ui-orchestration)
25. [Priority Event Queue](#25-priority-event-queue)
26. [Conflict Resolution](#26-conflict-resolution)
27. [Full vs Partial Recompute](#27-full-vs-partial-recompute)

---

## 1. System Overview

### Purpose

An AI-powered financial planning assistant that analyzes a user's financial situation and delivers personalized projections, portfolio recommendations, tax optimization strategies, and cashflow analysis — all through a conversational interface.

### Key Capabilities

| Capability | Description |
|---|---|
| Chat-based Q&A | Multi-agent reasoning pipeline triggered by natural language questions |
| Document upload | Analyze tax returns, bank statements, investment statements, and debt documents |
| Real-time streaming | WebSocket events push panel updates to the UI as each agent completes |
| Session memory | Redis + Markdown + ChromaDB persist context across multiple conversations |
| PII safety | Raw financial data is never stored — only abstracted signals are persisted |
| A2UI v2 orchestration | Server controls WHAT/HOW/WHEN/WHY for every UI panel — frontend is a pure renderer |

### Core Design Principles

1. **Trust-by-Design** — Exact income, account numbers, and SSNs are processed in-memory and immediately discarded. Only derived signals (e.g. `income_range: "UPPER_MIDDLE"`) are stored.
2. **Hybrid Compute** — All financial numbers (savings projections, risk scores, portfolio allocations, stress tests) are produced by deterministic math functions. LLMs write narrative text only — they never produce or alter numbers.
3. **Orchestrated Agency** — LangGraph controls execution order deterministically. LLMs only decide *what* to run (planner) and *what to say* (narrative/explanation).
4. **Reactive Consistency** — The ReactiveEngine listens for upstream state changes (e.g. `PROFILE_UPDATED`) and automatically re-computes all downstream agents (simulation → portfolio → risk) without LLM involvement.
5. **Graceful Degradation** — Redis falls back to in-memory, ChromaDB falls back to in-memory, every graph node has try/catch so one failing agent cannot crash the pipeline.
6. **A2UI v2 Orchestration** — The server produces a complete rendering contract per panel (`{id, type, data, meta, insight, actions}`) via `ui.composer.js`. The frontend is a pure rendering layer — it never decides layout, priority, or panel visibility.

---

## 2. Architecture (Detailed)

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  USER LAYER                                                       │
│  Angular SPA                                                      │
│  • ChatComponent — message input, quick actions                   │
│  • FileUploadComponent — drag-drop, confirmation step             │
│  • DynamicRendererComponent — renders panels from ui[] array      │
│  • WebSocketService — receives real-time agent events             │
└──────────────────────────┬──────────────────┬────────────────────┘
                           │ POST /api/chat    │ POST /api/upload
                           ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  ROUTE LAYER (Express)                                            │
│  chat.route.js                    upload.route.js                │
│  • loads session from Redis        • runs DocumentIngestionAgent │
│  • reloads docInsights from Redis  • pre-seeds graph plan        │
│  • passes plannerContext hints     • saves docInsights to Redis  │
│  • saves all agent outputs         • deduplicates UI panels      │
└──────────────────────────────────┬──────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION LAYER (LangGraph StateGraph)                       │
│  graph.js                                                         │
│  • withFallback() — per-node try/catch + AGENT_COMPLETED event   │
│  • Skips node_planner if plan is pre-seeded (upload path)        │
│  • Routing: planner→profile→[tax→cashflow→]simulation→           │
│             portfolio→risk→explanation                            │
└──────────────────────────────────┬──────────────────────────────┘
                                   │ agent invocations
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  AGENT LAYER (Hybrid: deterministic compute + LLM narrative)      │
│  PlannerAgent    ProfileAgent     SimulationAgent                │
│  TaxAgent        CashflowAgent    PortfolioAgent                 │
│  RiskAgent       ExplanationAgent DocumentIngestionAgent         │
│                                                                   │
│  Simulation: calculator.js math → LLM writes summary text only  │
│  Portfolio:  portfolio.compute.js → LLM writes rationale only   │
│  Risk:       risk.compute.js     → LLM writes factor text only  │
│  Tax/Cashflow: pure-function sub-agents → LLM writes strategies │
└──────────────────┬──────────────────────────┬────────────────────┘
                   │ events (PROFILE_UPDATED…) │ read state
                   ▼                           │
┌─────────────────────────────────────────────────────────────────┐
│  REACTIVE ENGINE LAYER                                            │
│  ReactiveEngine — dependency-map cascade (NO LLM)                │
│  StateManager   — per-session central state (in-process)         │
│                                                                   │
│  PROFILE_UPDATED    → recompute simulation, portfolio, risk      │
│  SIMULATION_UPDATED → recompute portfolio, risk                  │
│  PORTFOLIO_UPDATED  → recompute risk                             │
│  TAX/CASHFLOW_UPDATED → recompute simulation                     │
└──────────────────┬───────────────────────────────────────────────┘
                   │ read/write
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  MEMORY LAYER                                                     │
│  ┌───────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │ Redis          │  │ Markdown files   │  │ ChromaDB (vector) │ │
│  │ session:{id}   │  │ data/sessions/   │  │ session-scoped    │ │
│  │ JSON, TTL 1h   │  │ {sessionId}.md   │  │ RAG retrieval     │ │
│  └───────────────┘  └──────────────────┘  └───────────────────┘ │
└──────────────────┬───────────────────────────────────────────────┘
                   │ events
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  EVENT BUS (AppEventEmitter extends EventEmitter)                 │
│  WS route listens → broadcasts to Angular client                  │
│  Events: AGENT_STARTED, AGENT_COMPLETED, PLANNER_DECIDED,        │
│          PROFILE_UPDATED, SIMULATION_UPDATED, TAX_UPDATED, …     │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User message
    │
    ├─→ Load session (Redis) + RAG context (ChromaDB)
    ├─→ Append user message to session history
    │
    ▼
LangGraph.invoke({ message, profile, taxInsights, cashflowInsights, … })
    │
    ├─→ node_planner   → plan (agents[], ui[], confidence, rationale)
    ├─→ node_profile   → profile (name, age, income, risk_tolerance, …)
    ├─→ node_tax       → tax (efficiency_score, strategies[], bracket)
    ├─→ node_cashflow  → cashflow (budget_health, recommendations[])
    ├─→ node_simulation→ simulation (milestones[], projected_savings)
    ├─→ node_portfolio → portfolio (allocation[], strategy, return%)
    ├─→ node_risk      → risk (score, factors[], mitigation_steps[])
    └─→ node_explanation → explanation (plain text string)
    │
    ├─→ Save all outputs to Redis
    ├─→ Emit domain events (→ WebSocket → Angular panels update live)
    ├─→ Write Markdown memory snapshot
    └─→ HTTP response: { message, ui[], data{}, meta{}, trace[] }
```

### Decision vs Execution Separation

| Concern | Owner | Mechanism |
|---|---|---|
| Which agents to run | LLM (PlannerAgent) | Returns `agents[]` in JSON |
| Execution order | LangGraph routing functions | Deterministic `if agents.includes(x)` |
| Agent dependencies (guardrails) | PlannerAgent code | `portfolio` requires `simulation`; `risk` requires `portfolio` |
| Fallback on LLM failure | `withFallback()` wrapper | Per-node try/catch; empty state patch returned |
| UI panels to render | LLM (planner) + ROUTING_MAP | `ui[]` array with type strings |

---

## 3. Agent Catalog

### planner_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/planner.agent.js` |
| **Responsibility** | Decide which agents to invoke and which UI panels to render |
| **Trigger** | Every chat message (skipped on upload if plan is pre-seeded) |
| **Inputs** | `message: string`, `context: string`, `profileExists: "yes"/"no"`, `simulationExists: "yes"/"no"` |
| **Output** | `plan` — see schema below |
| **Failure mode** | Returns `SAFE_DEFAULT_PLAN` — never throws |

**Plan output schema**:
```json
{
  "intent": "User wants retirement projection",
  "required_agents": ["profile", "simulation", "explanation"],
  "optional_agents": ["portfolio"],
  "missing_data": ["tax_document"],
  "confidence": "high",
  "decision_rationale": "Included simulation because user asked about retirement timeline.",
  "agents": ["profile", "simulation", "explanation"],
  "ui": [
    { "type": "profile_summary" },
    { "type": "simulation_chart" },
    { "type": "explanation_panel" }
  ],
  "params": {}
}
```

**Guardrails (applied in code, not LLM)**:
- `explanation` always appended if missing
- `portfolio` injects `simulation` if not already present
- `risk` injects `portfolio` → `simulation` if not already present

---

### profile_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/profile.agent.js` |
| **Responsibility** | Extract structured user financial profile from context and message |
| **Trigger** | Plan includes `"profile"` |
| **Inputs** | `message`, `memory` (markdown), `ragContext` (ChromaDB) |
| **Output** | `{ name, age, income, savings, monthly_expenses, retirement_age, risk_tolerance, goals[] }` |
| **Dependencies** | None — runs first after planner |

---

### simulation_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/simulation.agent.js` |
| **Responsibility** | Compute retirement projection (deterministic math) + LLM narrative summary |
| **Trigger** | Plan includes `"simulation"` |
| **Inputs** | `profile`, `message`, `ragContext` |
| **Output** | `{ can_retire_at_target, projected_savings_at_retirement, required_savings_at_retirement, savings_gap, monthly_shortfall_or_surplus, years_of_runway, milestones[3], summary, assumptions{} }` |
| **Dependencies** | Runs after profile (uses profile data; falls back to `DEFAULT_PROFILE` if null) |

**Internal pipeline** (hybrid):

| Step | Component | What it does |
|---|---|---|
| 1 | `financial.calculator.js` | Compound interest projection, 4% SWR, 3 milestones at 1/3 intervals |
| 2 | `simulationChain` (LLM) | Writes 2–3 sentence summary + 1-sentence note per milestone |

**Note**: The LLM never produces numbers. All projection values come from the calculator. If the LLM fails, a fallback summary is constructed from the calculated numbers.

---

### portfolio_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/portfolio.agent.js` |
| **Responsibility** | Compute deterministic allocation + LLM rationale text |
| **Trigger** | Plan includes `"portfolio"` |
| **Inputs** | `profile`, `simulation` |
| **Output** | `{ allocation[], strategy, expected_annual_return_percent, rebalance_frequency, rationale }` |
| **Dependencies** | Requires simulation results |

**Internal pipeline** (hybrid):

| Step | Component | What it does |
|---|---|---|
| 1 | `portfolio.compute.js` | Base allocation from risk tolerance + glide-path tilt by years to retirement |
| 2 | `portfolioRationaleChain` (LLM) | Writes 2–3 sentence rationale text explaining why this allocation fits the user |

**Compute rules** (deterministic, no LLM):
- `low` risk → 30% equities / 55% bonds / 5% real estate / 10% cash
- `medium` risk → 60% equities / 30% bonds / 5% real estate / 5% cash
- `high` risk → 80% equities / 12% bonds / 5% real estate / 3% cash
- ≤10 years to retirement: −10% equities shifted to bonds (mid-glide path)
- ≤5 years to retirement: −20% equities shifted to bonds (near-retirement path)
- Expected return = equity% × 9% + bond% × 3% (weighted blend)

---

### risk_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/risk.agent.js` |
| **Responsibility** | Compute deterministic risk score + stress tests + LLM factor narrative |
| **Trigger** | Plan includes `"risk"` |
| **Inputs** | `profile`, `portfolio`, `simulation` |
| **Output** | `{ overall_risk_score, risk_level, factors[], mitigation_steps[], stress_test{} }` |
| **Dependencies** | Requires portfolio + simulation results |

**Internal pipeline** (hybrid):

| Step | Component | What it does |
|---|---|---|
| 1 | `risk.compute.js` | Score 1–10 from equity%, time horizon, savings gap; compute stress tests |
| 2 | `riskNarrativeChain` (LLM) | Writes factor descriptions + mitigation step strings only |

**Scoring formula** (deterministic, no LLM):
```
equityRisk = equity% ≥75 → 3, ≥55 → 2, else 1        (weight ×2)
timeRisk   = years ≤5 → 3, ≤10 → 2, ≤20 → 1, else 0  (weight ×2)
gapRisk    = gap ≥$500k → 3, ≥$100k → 2, >0 → 1, else 0 (weight ×3)
score      = round( (equity×2 + time×2 + gap×3) / 21 × 10 )  →  1–10
```
**Stress tests** (deterministic):
- `market_crash_20pct_impact` = −(projected_savings × equity% × 0.20)
- `inflation_spike_impact` = −(projected_savings × 0.05)

---

### tax_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/tax.agent.js` |
| **Responsibility** | Analyze tax efficiency from abstracted signals and generate optimization strategies |
| **Trigger** | Plan includes `"tax"` AND `taxInsights` is non-null in graph state |
| **Inputs** | `taxInsights` (sanitized signals), `profile`, `simulation` |
| **Output** | `{ tax_efficiency_score, tax_bracket, effective_rate, income_range, deductions_level, deduction_analysis, optimization_strategies[], retirement_tax_impact, key_insight, disclaimer }` |
| **Dependencies** | Requires `taxInsights` in state (from document upload, persisted to Redis) |

**Internal sub-agent pipeline** (pure functions — no extra LLM calls):

| Step | Function | Purpose |
|---|---|---|
| 1 | `parseTaxSignals()` | Validate and normalize incoming signals |
| 2 | `analyzeDeductions()` | Score deduction utilization (1–4), flag gaps |
| 3 | LLM chain | Generate optimization strategies |
| 4 | `rankOptimizationStrategies()` | Sort by priority; boost deduction-gap strategies |

---

### cashflow_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/cashflow.agent.js` |
| **Responsibility** | Analyze spending patterns and savings health from abstracted signals |
| **Trigger** | Plan includes `"cashflow"` AND `cashflowInsights` is non-null in graph state |
| **Inputs** | `cashflowInsights` (sanitized signals), `profile` |
| **Output** | `{ budget_health, savings_rate_label, spending_level, spending_risk{}, monthly_surplus_indicator, top_spending_categories[], recommendations[], savings_acceleration_potential, savings_insight{}, key_insight, disclaimer }` |
| **Dependencies** | Requires `cashflowInsights` in state |

**Internal sub-agent pipeline**:

| Step | Function | Purpose |
|---|---|---|
| 1 | `parseCashflowSignals()` | Validate and normalize signals |
| 2 | `classifySpendingRisk()` | Map spending level → `low/medium/high/critical` |
| 3 | LLM chain | Generate recommendations |
| 4 | `deriveSavingsInsight()` | Compute savings acceleration potential score (1–5) |

---

### document_ingestion_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/document.ingestion.agent.js` |
| **Responsibility** | Classify document, extract abstracted signals, route to appropriate agents |
| **Trigger** | POST /api/upload only |
| **Inputs** | Raw document text (in-memory buffer, never persisted), filename |
| **Output** | `{ document_type, confidence, abstracted_signals{}, suggested_agents[], suggested_ui[], taxInsights, cashflowInsights, portfolioInsights, debtInsights, pii_stored: false, raw_document_stored: false }` |
| **Dependencies** | `ROUTING_MAP` in `utils/document.routing.js` |

---

### explanation_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/explanation.agent.js` |
| **Responsibility** | Write a human-readable summary of all agent outputs addressing the user's question |
| **Trigger** | Always — last node in every pipeline |
| **Inputs** | `profile`, `simulation`, `portfolio`, `risk`, `message` |
| **Output** | Plain text string (3–5 sentences) |
| **Dependencies** | Runs after all other agents; uses whatever state is available |

---

## 4. Orchestration Logic

### LangGraph State Channels

All agent outputs flow through a typed `StateGraph` with the following channels:

```javascript
{
  // Inputs
  message, sessionContext, ragContext, memory, _sessionId, plannerContext,
  // Agent outputs
  plan, profile, simulation, portfolio, risk, tax, cashflow, explanation,
  // Document insight channels (populated from Redis session)
  taxInsights, cashflowInsights, portfolioInsights, debtInsights,
  // Trace (accumulates across all nodes)
  trace
}
```

All channels use merge strategy `(a, b) => b ?? a` — a node's return value overwrites the channel only if non-null. The `trace` channel concatenates arrays.

### Execution Order (Sequential)

```
__start__
    │
    ▼
node_planner ──(skipped if plan pre-seeded)──┐
    │                                         │
    ▼ (conditional: first matching agent)     │
node_profile                                  │
    │                                         │
    ▼ (conditional)                           │
node_tax ──(skipped if no taxInsights)        │
    │                                         │
    ▼ (conditional)                           │
node_cashflow ──(skipped if no cashflowInsights)
    │
    ▼ (conditional)
node_simulation
    │
    ▼ (conditional)
node_portfolio
    │
    ▼ (conditional)
node_risk
    │
    ▼ (always)
node_explanation
    │
    ▼
END
```

### Per-Node Fallback Wrapper

Every node is wrapped by `withFallback(agentName, fn)`:

```javascript
function withFallback(agentName, fn) {
  return async (state) => {
    eventEmitter.emitAgentStarted(state._sessionId, agentName);
    const start = Date.now();
    try {
      const result = await fn(state);
      eventEmitter.emitAgentCompleted(state._sessionId, agentName, Date.now() - start, result);
      return result;
    } catch (err) {
      log.error(`node_${agentName} FAILED: ${err.message}`);
      eventEmitter.emitAgentCompleted(state._sessionId, agentName, Date.now() - start, { error: err.message });
      return { trace: [{ agent: agentName, latencyMs: ..., error: err.message }] };
    }
  };
}
```

**Effect**: A failing agent returns an empty state patch `{}`. The pipeline continues to `explanation`, which uses whatever previous outputs are available (or defaults).

---

## 5. Memory & Data Model

### Redis

**Key pattern**: `session:{sessionId}`
**TTL**: 3600 seconds (configurable via `SESSION_TTL_SECONDS` env var)
**Fallback**: In-memory `Map` when Redis is unavailable

**Full session schema**:

```json
{
  "profile": {
    "name": "User", "age": 35, "income": 80000, "savings": 200000,
    "monthly_expenses": 3500, "retirement_age": 65,
    "risk_tolerance": "medium", "goals": ["retire by 65"]
  },
  "simulation": {
    "can_retire_at_target": true,
    "projected_savings_at_retirement": 1200000,
    "monthly_shortfall_or_surplus": 500,
    "years_of_runway": 25,
    "milestones": [
      { "year": 2031, "savings": 350000, "note": "Emergency fund fully funded" },
      { "year": 2041, "savings": 700000, "note": "Halfway to retirement goal" },
      { "year": 2051, "savings": 1200000, "note": "Retirement target reached" }
    ],
    "summary": "You are on track to retire at 65 with $1.2M in savings."
  },
  "portfolio": {
    "allocation": [
      { "asset": "Equities", "percent": 60 },
      { "asset": "Bonds", "percent": 30 },
      { "asset": "Real Estate", "percent": 5 },
      { "asset": "Cash", "percent": 5 }
    ],
    "strategy": "balanced",
    "expected_annual_return_percent": 7,
    "rebalance_frequency": "annually",
    "rationale": "Balanced allocation suits medium risk tolerance with 30-year horizon."
  },
  "risk": {
    "overall_risk_score": 6,
    "risk_level": "medium",
    "factors": [
      { "factor": "Market Volatility", "impact": "high", "description": "..." }
    ],
    "mitigation_steps": ["Increase emergency fund to 6 months expenses"],
    "stress_test": { "market_crash_20pct_impact": -240000, "inflation_spike_impact": -80000 }
  },
  "tax": {
    "tax_efficiency_score": 7,
    "tax_bracket": "22%",
    "effective_rate": "18.5%",
    "income_range": "UPPER_MIDDLE",
    "deductions_level": "MODERATE",
    "optimization_strategies": [
      { "strategy": "Maximize 401(k) contributions", "priority": "high", "estimated_impact": "Reduce taxable income by $22,500" }
    ]
  },
  "cashflow": {
    "budget_health": "good",
    "savings_rate_label": "MODERATE",
    "spending_level": "ELEVATED",
    "monthly_surplus_indicator": "positive",
    "top_spending_categories": ["Housing", "Food", "Transport"],
    "recommendations": [
      { "action": "Reduce dining out", "priority": "medium", "estimated_monthly_saving": "moderate" }
    ]
  },
  "documentInsights": {
    "tax": {
      "income_range": "UPPER_MIDDLE", "tax_bracket": "22%",
      "effective_rate": "18.5%", "deductions_level": "MODERATE",
      "filing_status": "single", "optimization_opportunities": [],
      "_pii_note": "Raw income, SSN, and exact tax amounts were not persisted."
    },
    "cashflow": {
      "income_range": "MIDDLE", "spending_level": "ELEVATED",
      "savings_rate": "LOW", "top_categories": ["Housing", "Food"],
      "budget_health": "fair",
      "_pii_note": "Exact account balances and transaction amounts were not persisted."
    }
  },
  "messages": [
    { "role": "user", "content": "Can I retire at 55?", "ts": "2026-03-21T10:00:00.000Z" },
    { "role": "assistant", "content": "Based on your profile...", "ts": "2026-03-21T10:00:45.000Z" }
  ],
  "updatedAt": "2026-03-21T10:00:45.000Z"
}
```

**Allowed vs Forbidden in Redis**:

| Allowed ✓ | Forbidden ✗ |
|---|---|
| `income_range: "UPPER_MIDDLE"` | `income: 145000` |
| `tax_bracket: "22%"` | `grossIncome: 145000` |
| `spending_level: "ELEVATED"` | Account numbers |
| `deductions_level: "MODERATE"` | SSN / EIN |
| Agent output objects (scores, strategies) | Raw document text |
| Message history (user questions + AI responses) | Exact transaction amounts |

---

### Markdown Memory

**Path**: `backend/data/sessions/{sessionId}.md`
**Written by**: `MarkdownMemory.write()` after every successful pipeline run
**Read by**: LangGraph as `memory` and `sessionContext` inputs on every request

**Example file**:

```markdown
# Financial Planning Session: abc-123-def
_Generated: 2026-03-21T10:00:45.000Z_
_⚠️ PII Policy: This file contains abstracted signals only. No raw documents, SSNs, account numbers, or exact monetary values are stored._

## User Profile (Abstracted)
- **Age**: 35 — Mid Career
- **Income Range**: UPPER_MIDDLE
- **Savings Level**: MODERATE
- **Monthly Expenses**: MODERATE
- **Target Retirement Age**: 65
- **Risk Tolerance**: medium
- **Goals**: retire by 65, buy a house

## Simulation Results
- **Retirement Feasibility**: ✅ On Track
- **Years of Runway**: 25
- **Summary**: You are on track to retire at 65 with $1.2M in savings.

## Tax Intelligence (Abstracted Signals)
> 🔒 Raw tax document NOT stored. Only derived signals below.
- **Income Range**: UPPER_MIDDLE
- **Tax Bracket**: 22%
- **Effective Rate**: 18.5%
- **Deductions Level**: MODERATE
- **Filing Status**: single

## Cashflow Intelligence (Abstracted Signals)
> 🔒 Raw bank statement NOT stored. Only derived signals below.
- **Income Range**: MIDDLE
- **Spending Level**: ELEVATED
- **Savings Rate**: LOW
- **Budget Health**: fair
- **Top Spending Categories**: Housing, Food, Transport

---
_Session context for LLM reasoning. No PII. No raw documents._
```

---

### Vector DB (ChromaDB)

| Property | Value |
|---|---|
| **Collection** | `financial_planning` |
| **What is embedded** | Anonymized insight summaries per session |
| **Embedding model** | Configured via `EMBEDDING_MODEL` env var (defaults to Ollama) |
| **Session isolation** | Every query includes `where: { sessionId }` filter |
| **Retrieval** | `searchAsContext(query, sessionId)` → top-k chunks as string → injected as `ragContext` |
| **Fallback** | In-memory array with same session-scoped filter |

**Example stored document**:
```
"Document analysis for session abc-123: moderate income UPPER_MIDDLE range, 22% tax bracket, good savings rate. Key signals: eligible for Roth conversion, HSA opportunity identified."
```

---

## 6. Session Management

### Session Lifecycle

```
1. Client sends POST /api/chat (no sessionId on first message)
2. Server generates uuidv4() → new sessionId
3. sessionId returned in response body
4. Client stores sessionId in component state (this.sessionId)
5. All subsequent requests include sessionId
6. Session expires after TTL (default: 1 hour)
```

### Session ID Propagation

```
Frontend                          Backend
─────────                         ───────
First request: { message }        → Server generates UUID
Response: { sessionId: "abc-123" }
this.sessionId = "abc-123"
Chat: { message, sessionId }      → Loaded from Redis
Upload: { sessionId } (formData)  → Same session enriched
WebSocket connect(sessionId)      → WS filtered by sessionId
```

### Isolation Guarantees

| Layer | Isolation Mechanism |
|---|---|
| Redis | Key prefix `session:{sessionId}` — different keys per user |
| Vector DB | `where: { sessionId }` filter on every query and store |
| Markdown | Separate file per session: `{sessionId}.md` |
| Events | WS messages include `sessionId`; client only processes its own |
| RAG | Each session's vector embeddings are tagged with `sessionId` metadata |

---

## 7. Multi-Modal Ingestion

### Pipeline

```
POST /api/upload (multipart/form-data)
    │
    ├─→ multer memoryStorage (file NEVER written to disk)
    │
    ▼
DocumentIngestionAgent.run(documentText, fileName)
    │
    ├─→ LLM: classify + extract raw_values (ephemeral)
    ├─→ sanitize raw_values → abstracted signals (pii.sanitizer.js)
    ├─→ discard raw_values
    └─→ routeDocument(docType) → { agents[], ui[], insightKey }
    │
    ▼
Build syntheticPlan (pre-seeds LangGraph — skips node_planner)
    │
    ▼
financialGraph.invoke({ plan, taxInsights/cashflowInsights/... })
    │
    ▼
Save { documentInsights } to Redis (for future chat messages)
```

### Document Type Routing

| Document Type | Agents | UI Panels | Insight Stored |
|---|---|---|---|
| `tax_document` | profile, tax, simulation, explanation | profile_summary, tax_panel, simulation_chart, explanation_panel | `documentInsights.tax` |
| `bank_statement` | profile, cashflow, simulation, explanation | profile_summary, cashflow_panel, simulation_chart, explanation_panel | `documentInsights.cashflow` |
| `investment_statement` | profile, portfolio, risk, simulation, explanation | profile_summary, portfolio_view, risk_dashboard, simulation_chart, explanation_panel | `documentInsights.portfolio` |
| `debt_document` | profile, simulation, cashflow, explanation | profile_summary, simulation_chart, cashflow_panel, explanation_panel | `documentInsights.debt` |
| `unknown` | profile, simulation, explanation | profile_summary, simulation_chart, explanation_panel | — |

### Abstracted Signal Schemas

**taxInsights**:
```json
{
  "income_range": "UPPER_MIDDLE",
  "tax_bracket": "22%",
  "effective_rate": "18.5%",
  "deductions_level": "MODERATE",
  "filing_status": "single",
  "optimization_opportunities": ["Maximize HSA contributions"],
  "_pii_note": "Raw income, SSN, and exact tax amounts were not persisted."
}
```

**cashflowInsights**:
```json
{
  "income_range": "MIDDLE",
  "spending_level": "ELEVATED",
  "savings_rate": "LOW",
  "top_categories": ["Housing", "Food", "Transport"],
  "budget_health": "fair",
  "_pii_note": "Exact account balances and transaction amounts were not persisted."
}
```

**portfolioInsights**:
```json
{
  "portfolio_size_label": "ESTABLISHED",
  "asset_mix": [],
  "account_type": "401k",
  "performance_label": "unknown",
  "_pii_note": "Exact portfolio value and account numbers were not persisted."
}
```

**debtInsights**:
```json
{
  "debt_level_label": "MODERATE",
  "debt_types": ["mortgage", "auto"],
  "dti_label": "MANAGEABLE",
  "_pii_note": "Exact debt balances, account numbers, and creditor details were not persisted."
}
```

### Re-using Document Insights in Subsequent Chat

After upload, insights are saved to `session.documentInsights` in Redis. When the user sends a subsequent chat message:

```javascript
// chat.route.js
const docInsights = session.documentInsights || {};

financialGraph.invoke({
  taxInsights:       docInsights.tax      || null,
  cashflowInsights:  docInsights.cashflow || null,
  portfolioInsights: docInsights.portfolio || null,
  debtInsights:      docInsights.debt     || null,
  ...
});
```

This means if the user asks "tell me more about my tax situation", the planner includes `tax` in agents, and `node_tax` finds `taxInsights` populated from their previous upload.

---

## 8. PII & Trust Model

### What is NOT Stored

| Data Type | Where it appears | What happens to it |
|---|---|---|
| Raw document text | `req.file.buffer` (in-memory) | Discarded after `toString()`, never written anywhere |
| Exact income / gross income | LLM `raw_values.grossIncome` | Mapped to range label, `raw_values` discarded |
| Account numbers | LLM `raw_values` | Never extracted from raw_values to any persistent field |
| SSN / EIN | Text pattern | Redacted by `redactDocument()` if ever logged |
| Exact tax amounts | LLM `raw_values.effectiveTaxRate` | Mapped to bracket label string |
| Transaction amounts | LLM `raw_values` | Mapped to `spending_level` label |

### What IS Stored

| Data | Storage location | Example |
|---|---|---|
| Income range label | Redis + Markdown | `"income_range": "UPPER_MIDDLE"` |
| Tax bracket label | Redis + Markdown | `"tax_bracket": "22%"` |
| Spending level label | Redis + Markdown | `"spending_level": "ELEVATED"` |
| Deduction level label | Redis + Markdown | `"deductions_level": "MODERATE"` |
| Agent outputs (strategies, scores) | Redis | `optimization_strategies[{strategy, priority}]` |
| Anonymized summaries | Vector DB | `"UPPER_MIDDLE income range, 22% bracket..."` |

### Transformation Example

**BEFORE** (in LLM `raw_values`, in-memory only):
```json
{
  "grossIncome": 145000,
  "effectiveTaxRate": 18.5,
  "marginalRate": 22,
  "totalDeductions": 22000
}
```

**AFTER** (sanitized by `pii.sanitizer.js`, stored to Redis):
```json
{
  "income_range": "UPPER_MIDDLE",
  "tax_bracket": "22%",
  "effective_rate": "18.5%",
  "deductions_level": "MODERATE",
  "_pii_note": "Raw income, SSN, and exact tax amounts were not persisted."
}
```

### Sanitizer Functions (`utils/pii.sanitizer.js`)

| Function | Input | Output |
|---|---|---|
| `incomeToRange(income)` | `145000` | `"UPPER_MIDDLE"` |
| `taxRateToLabel(rate)` | `22` | `"22%"` |
| `savingsRateToLevel(pct)` | `18` | `"MODERATE"` |
| `deductionsToLevel(deductions, income)` | `22000, 145000` | `"MODERATE"` |
| `spendingToLevel(monthlySpend, monthlyIncome)` | `3800, 5500` | `"ELEVATED"` |
| `redactDocument(text)` | Raw text with SSN/amounts | Text with `[SSN-REDACTED]`, `$[AMOUNT]` |

---

## 9. Failure & Fallback Strategy

### Redis DOWN

```
1. Redis connection fails at startup
2. log.warn("Redis unavailable — using in-memory session store")
3. _useRedis = false → all reads/writes go to this._fallback (Map)
4. Sessions survive the current process lifetime only
5. On backend restart: all sessions are lost
6. Impact: No cross-restart persistence; otherwise fully functional
```

### Vector DB (ChromaDB) DOWN

```
1. ChromaDB unavailable (connection error on first query)
2. _useChroma = false → all reads/writes go to this._fallbackDocs (Array)
3. Session-scoped filtering still applied (metadata.sessionId === sessionId)
4. RAG quality degrades (small in-memory corpus)
5. Impact: Weaker context retrieval; no crash
```

### Both DOWN (Fully Degraded Mode)

```
1. Profile agent runs from message only (no RAG context, no prior memory)
2. Simulation uses freshly-extracted profile
3. All agents complete
4. Session data stored only in-memory (lost on restart)
5. Impact: No persistence across restarts; real-time session fully functional
```

### Individual Agent Failure

```
1. withFallback() catches exception
2. Logs: "node_{agentName} FAILED (Xms): {error message}"
3. Emits: AGENT_COMPLETED with { error: err.message }
4. Returns: {} (empty state patch — channel values unchanged)
5. Pipeline continues to next node
6. explanation runs with whatever outputs are available
7. Impact: Missing panel data; explanation may be partial but response succeeds
```

### Planner Chain Failure

```
1. plannerChain.invoke() throws
2. PlannerAgent catches → returns SAFE_DEFAULT_PLAN
3. SAFE_DEFAULT_PLAN: agents = [profile, simulation, explanation]
4. Impact: All documents/context still processed; UI shows core panels
```

---

## 10. Debugging & Observability

### Log Channels

| Channel | Used in | Example output |
|---|---|---|
| `log.route` | Route files | `POST /chat | session: abc-123` |
| `log.graph` | `graph.js` | `✔ node_simulation DONE (4800ms) | can_retire=true` |
| `log.agent` | Agent files | `TaxAgent [2/4] analyzeDeductions | score=2/4 | gap=true` |
| `log.redis` | `redis.memory.js` | `SET session:abc-123 (TTL 3600s, 842 bytes)` |
| `log.error` | Everywhere | Full stack trace on failures |
| `log.warn` | Fallback paths | `Redis unavailable — using in-memory session store` |

### Event Bus (Real-Time Observability)

| Event | Fired when | Payload |
|---|---|---|
| `AGENT_STARTED` | Node begins | `{ sessionId, agentName }` |
| `AGENT_COMPLETED` | Node ends (success or failure) | `{ sessionId, agentName, latencyMs, output }` |
| `PLANNER_DECIDED` | Planner returns a plan | `{ sessionId, plan }` |
| `PROFILE_UPDATED` | Profile saved to Redis | `{ sessionId, profile }` |
| `SIMULATION_UPDATED` | Simulation saved to Redis | `{ sessionId, simulation }` |
| `TAX_UPDATED` | Tax saved to Redis | `{ sessionId, tax }` |
| `CASHFLOW_UPDATED` | Cashflow saved to Redis | `{ sessionId, cashflow }` |
| `PORTFOLIO_UPDATED` | Portfolio saved to Redis | `{ sessionId, portfolio }` |
| `RISK_UPDATED` | Risk saved to Redis | `{ sessionId, risk }` |
| `EXPLANATION_READY` | Explanation text available | `{ sessionId, explanation }` |

### HTTP Response Trace

Every `/api/chat` and `/api/upload` response includes a `trace[]`:

```json
{
  "trace": [
    { "agent": "planner",    "latencyMs": 3200, "output": { "intent": "...", "confidence": "high" } },
    { "agent": "profile",    "latencyMs": 4100, "output": { "age": 35, "income": 80000 } },
    { "agent": "simulation", "latencyMs": 5800, "output": { "can_retire_at_target": true } },
    { "agent": "explanation","latencyMs": 2900, "output": "You're on track to retire at 65..." }
  ]
}
```

If a node fails, its trace entry contains `{ "agent": "tax", "latencyMs": 200, "error": "JSON parse error..." }`.

### HTTP Response `meta` Field

```json
{
  "meta": {
    "intent": "Retirement feasibility check",
    "confidence": "high",
    "decision_rationale": "Included simulation because user asked about retirement timeline.",
    "missing_data": ["tax_document"]
  }
}
```

---

## 11. Operational Playbook

### Read session data from Redis

```bash
# Direct Redis CLI
redis-cli GET "session:abc-123-def-456"

# Pretty-print JSON
redis-cli GET "session:abc-123" | python3 -m json.tool

# Via REST API
curl http://localhost:3000/api/session/abc-123
```

### List all sessions (find session IDs)

```bash
redis-cli KEYS "session:*"
```

### Read markdown memory file

```bash
cat backend/data/sessions/abc-123.md
```

### Read vector embeddings for a session

```bash
# ChromaDB HTTP API
curl -X POST http://localhost:8000/api/v1/collections/financial_planning/get \
  -H "Content-Type: application/json" \
  -d '{"where": {"sessionId": "abc-123"}}'
```

### Clear a single Redis session

```bash
# Via Redis CLI
redis-cli DEL "session:abc-123"

# Via REST API (DELETE endpoint)
curl -X DELETE http://localhost:3000/api/session/abc-123
```

### Reset full user session (all layers)

```bash
# 1. Delete Redis key
redis-cli DEL "session:abc-123"

# 2. Delete markdown memory file
rm backend/data/sessions/abc-123.md

# 3. Delete vector embeddings (ChromaDB)
curl -X POST http://localhost:8000/api/v1/collections/financial_planning/delete \
  -H "Content-Type: application/json" \
  -d '{"where": {"sessionId": "abc-123"}}'

# 4. Disconnect WebSocket client (automatic on frontend reset button)
```

### Inspect what document insights were extracted

```bash
# Check Redis for documentInsights
redis-cli GET "session:abc-123" | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(json.dumps(s.get('documentInsights', {}), indent=2))
"
```

### Change session TTL

```bash
# In .env
SESSION_TTL_SECONDS=7200  # 2 hours

# Or per-key in Redis directly
redis-cli EXPIRE "session:abc-123" 7200
```

---

## 12. Sample End-to-End Flows

### Case 1: "Can I retire at 55?"

**Step 1 — Route**:
```
POST /api/chat { message: "Can I retire at 55?", sessionId: null }
→ New sessionId generated: "abc-123"
→ Session loaded from Redis: {} (empty — first message)
→ RAG context: "" (no prior embeddings)
```

**Step 2 — LangGraph**:
```
node_planner:
  Input: message="Can I retire at 55?", profileExists="no", simulationExists="no"
  Output: {
    intent: "Retirement feasibility check at age 55",
    agents: ["profile", "simulation", "explanation"],
    ui: [profile_summary, simulation_chart, explanation_panel],
    confidence: "high",
    decision_rationale: "Included simulation because user asked about retirement timeline."
  }

node_profile:
  Input: message + empty memory + empty RAG
  Output: { name: "User", age: 30, income: 80000, ... }  ← LLM infers defaults

node_simulation:
  Input: profile + message + currentYear=2026
  Output: {
    can_retire_at_target: false,
    projected_savings_at_retirement: 450000,
    milestones: [2031, 2036, 2041],
    summary: "With current savings rate, retiring at 55 leaves a $350k gap."
  }

node_explanation:
  Output: "Based on your current savings and income, retiring at 55 would result in a significant gap..."
```

**Step 3 — Memory updates**:
```
Redis: { profile, simulation, messages[user, assistant] }
Markdown: data/sessions/abc-123.md (profile + simulation sections)
Vector: anonymized summary stored
```

**Step 4 — Response**:
```json
{
  "sessionId": "abc-123",
  "message": "Based on your current savings and income...",
  "ui": [{"type":"profile_summary"}, {"type":"simulation_chart"}, {"type":"explanation_panel"}],
  "data": { "profile": {...}, "simulation": {...} },
  "meta": { "confidence": "high", "missing_data": ["tax_document", "bank_statement"] }
}
```

**WebSocket events fired (in order)**:
`AGENT_STARTED:planner` → `PLANNER_DECIDED` → `AGENT_STARTED:profile` → `PROFILE_UPDATED` → `AGENT_STARTED:simulation` → `SIMULATION_UPDATED` → `AGENT_STARTED:explanation` → `EXPLANATION_READY`

---

### Case 2: User uploads tax document

**Step 1 — Upload**:
```
POST /api/upload (multipart, file: W2.txt)
→ File buffered in memory (never written to disk)
→ DocumentIngestionAgent.run(documentText, "W2.txt")
```

**Step 2 — DocumentIngestionAgent**:
```
LLM classifies: document_type = "tax_document" (high confidence)
raw_values (ephemeral): { grossIncome: 145000, effectiveTaxRate: 18.5, marginalRate: 22 }
sanitize → taxInsights: { income_range: "UPPER_MIDDLE", tax_bracket: "22%", effective_rate: "18.5%" }
raw_values discarded ✓
routeDocument("tax_document") → agents: [profile, tax, simulation, explanation]
```

**Step 3 — LangGraph** (planner skipped — plan pre-seeded):
```
node_planner: SKIPPED (plan pre-seeded)
node_profile:    → profile extracted from synthetic message + context
node_tax:        → tax analysis from taxInsights (22% bracket, MODERATE deductions)
                   sub-agents: parseTaxSignals → analyzeDeductions (gap=false) → LLM → rankStrategies
node_simulation: → projection using real profile data
node_explanation:→ "Your W-2 shows an upper-middle income bracket at 22%..."
```

**Step 4 — Memory updates**:
```
Redis: {
  profile, simulation, tax,
  documentInsights: { tax: { income_range, tax_bracket, ... } }
}
Markdown: profile + simulation + tax intelligence sections
Vector: anonymized tax summary stored
```

---

### Case 3: User uploads bank statement

**Step 1 — DocumentIngestionAgent**:
```
document_type = "bank_statement"
raw_values: { monthlyIncome: 9000, monthlySpend: 7200, savingsRate: 20 }
sanitize → cashflowInsights: { income_range: "MIDDLE", spending_level: "ELEVATED", savings_rate: "GOOD" }
routeDocument("bank_statement") → agents: [profile, cashflow, simulation, explanation]
```

**Step 2 — LangGraph** (planner skipped):
```
node_profile:   → profile from synthetic message (income range hints from cashflow signals)
node_cashflow:  → analysis from cashflowInsights
                  sub-agents: parseCashflowSignals → classifySpendingRisk (risk=medium)
                              → LLM → deriveSavingsInsight (score=3/5)
node_simulation:→ projection with profile data
node_explanation:→ "Your bank statement reveals elevated spending at ~80% of income..."
```

**Step 3 — Profile panel**:
Now populated because `profile` agent is included in the bank_statement routing. The profile summary panel renders in the Angular UI immediately.

**Step 4 — Follow-up chat message**:
```
User: "How can I improve my savings rate?"
→ Redis loads session: { profile, cashflow, documentInsights: { cashflow: {...} } }
→ Graph invoked with cashflowInsights: session.documentInsights.cashflow
→ Planner includes "cashflow" in agents (context mentions spending)
→ node_cashflow re-runs with persisted cashflowInsights
→ Recommendations surfaced without re-uploading the document
```

---

## 13. WebSocket Role

The WebSocket connection (`/ws` endpoint on the backend, `WebSocketService` on the frontend) provides **real-time streaming of agent completion events**, enabling progressive panel rendering.

### Without WebSocket
```
User sends message → 30–60 second wait → All panels appear simultaneously
```

### With WebSocket
```
User sends message
  → [3s] PROFILE_UPDATED  → Profile panel renders
  → [8s] SIMULATION_UPDATED → Simulation chart renders
  → [14s] TAX_UPDATED     → Tax panel renders
  → [22s] EXPLANATION_READY → Chat message appears
```

### Connection Lifecycle

```
1. User sends first chat message via HTTP
2. Response contains sessionId
3. Frontend calls wsService.connect(sessionId)
4. WS connection opened: ws://localhost:3000/ws?sessionId=abc-123
5. Backend WS route subscribes to AppEventEmitter
6. Each event filtered by sessionId before broadcast
7. Frontend WebSocketService.messages observable emits received events
8. ChatComponent.handleWsMessage() processes events (currently: loading indicator)
```

### Event Flow Diagram

```
Backend AppEventEmitter
    │
    │ emit(SIMULATION_UPDATED, { sessionId: "abc-123", simulation: {...} })
    ▼
WS Route (listens to all events)
    │ filter: event.sessionId === ws.sessionId
    ▼
WebSocket.send(JSON.stringify({ type: "SIMULATION_UPDATED", data: simulation }))
    │
    ▼
Angular WebSocketService.messages (Subject)
    │
    ▼
DynamicRendererComponent (subscribes)
    │
    ▼
<app-simulation [simulation]="simulation"> renders immediately
```

### Current vs Potential Usage

| Event | Currently Used | Potential Enhancement |
|---|---|---|
| `AGENT_STARTED` | Loading spinner shown | Per-panel "analyzing…" state |
| `PROFILE_UPDATED` | Not wired to renderer | Progressive profile panel update |
| `SIMULATION_UPDATED` | Not wired to renderer | Live chart rendering as simulation completes |
| `EXPLANATION_READY` | Not wired to renderer | Chat message streaming |
| `PLANNER_DECIDED` | Not used | Show agent pipeline plan to user |

---

## 14. LLM vs Deterministic — Full Agent Map

### Hybrid Agent Model

As of v2, agents are **hybrid**: a deterministic compute function runs first and produces all numbers, then the LLM writes only narrative text referencing those pre-computed values.

```
Agent.run(inputs)
    │
    ├── Step 1: compute_fn(inputs)    ← pure JS math, no LLM
    │     Returns: numbers, scores, allocations
    │
    └── Step 2: llm_chain.invoke(...)  ← LLM sees computed numbers
          Returns: narrative text only (summary / rationale / descriptions)
```

### LLM Role per Agent

| Agent | Chain | LLM is asked to produce |
|---|---|---|
| **PlannerAgent** | `plannerChain` | Intent label, agents list, UI panels, confidence |
| **ProfileAgent** | `profileChain` | Structured JSON from natural language (entity extraction) |
| **SimulationAgent** | `simulationChain` | 2–3 sentence summary + 3 milestone notes (numbers pre-computed) |
| **PortfolioAgent** | `portfolioRationaleChain` | 2–3 sentence rationale explaining why allocation fits the user |
| **RiskAgent** | `riskNarrativeChain` | Factor descriptions + mitigation steps text (score pre-computed) |
| **TaxAgent** | `taxChain` | Tax optimization strategy text (ranked by code, not LLM) |
| **CashflowAgent** | `cashflowChain` | Spending recommendations text (risk classified by code) |
| **ExplanationAgent** | `explanationChain` | Final 3–5 sentence human-readable response (plain text) |
| **DocumentIngestionAgent** | `documentIngestionChain` | Document classification + ephemeral raw_values extraction |

**Total LLM calls per full pipeline**: up to 9. In hybrid agents, compute runs first — LLM only sees the result.

### What the LLM NEVER Does

| Forbidden LLM Action | Why | How it's enforced |
|---|---|---|
| Calculate savings projections | Hallucination risk | `financial.calculator.js` runs before LLM |
| Assign portfolio allocation % | Inconsistent numbers | `portfolio.compute.js` runs before LLM |
| Set the risk score (1–10) | Unpredictable scoring | `risk.compute.js` runs before LLM |
| Compute stress test dollar amounts | Arithmetic errors | `risk.compute.js` runs before LLM |
| Decide execution order of agents | Control-flow integrity | LangGraph routing functions (pure code) |
| Store or recall PII | Privacy violation | PII sanitizer discards raw values before any storage |

### Which Components are Purely Deterministic

These components contain **zero LLM calls**.

| Component | File | What it does |
|---|---|---|
| Retirement calculator | `utils/financial.calculator.js` | FV compound interest, annuity formula, 4% SWR rule, milestones |
| Portfolio compute | `agents/compute/portfolio.compute.js` | Risk-tolerance base allocation + glide-path shift + expected return |
| Risk compute | `agents/compute/risk.compute.js` | 3-factor weighted score (equity, time, gap) + stress tests |
| ReactiveEngine | `engine/reactive.engine.js` | Re-runs compute on upstream state change (no LLM) |
| StateManager | `engine/state.manager.js` | Per-session in-process state with atomic merge |
| LangGraph routing | `graph.js` | `if agents.includes('portfolio')` → next node |
| `withFallback()` wrapper | `graph.js` | Per-node try/catch, event emission |
| PlannerAgent guardrails | `planner.agent.js` | Enforce `explanation` always present; dependency rules |
| `SAFE_DEFAULT_PLAN` | `planner.agent.js` | Static fallback on chain failure |
| Tax sub-agents | `subagents/tax.subagents.js` | Normalize signals, score deductions, rank strategies |
| Cashflow sub-agents | `subagents/cashflow.subagents.js` | Normalize signals, classify risk, score savings |
| PII sanitizer | `utils/pii.sanitizer.js` | Map raw numbers to range labels (threshold rules) |
| `ROUTING_MAP` | `utils/document.routing.js` | Static document-type → agents/UI lookup |

### Mental Model

```
┌────────────────────────────────────────────────────────────────┐
│  DETERMINISTIC COMPUTE LAYER  (pure JS math, no LLM)          │
│                                                                │
│  financial.calculator.js → FV formula, milestones             │
│  portfolio.compute.js    → glide path allocation               │
│  risk.compute.js         → 3-factor weighted score            │
│  ReactiveEngine          → auto-cascade on upstream change     │
│  StateManager            → atomic per-session state           │
└────────────────────────────────────────────────────────────────┘
         ↓ computed numbers passed into LLM prompts
┌────────────────────────────────────────────────────────────────┐
│  LLM NARRATIVE LAYER  (non-deterministic)                      │
│                                                                │
│  PlannerAgent     → intent + UI decisions                      │
│  ProfileAgent     → entity extraction from natural language    │
│  SimulationAgent  → summary text (references computed numbers) │
│  PortfolioAgent   → rationale text (references computed alloc) │
│  RiskAgent        → factor descriptions (references score)     │
│  TaxAgent         → strategy recommendations                   │
│  CashflowAgent    → spending recommendations                   │
│  ExplanationAgent → final user-facing narrative                │
└────────────────────────────────────────────────────────────────┘
         ↓ all output gated by
┌────────────────────────────────────────────────────────────────┐
│  DETERMINISTIC CONTROL LAYER  (pure code)                      │
│                                                                │
│  LangGraph routing → WHICH node runs NEXT                      │
│  Guardrails        → dependency rules enforced in code         │
│  PII sanitizer     → raw values never reach storage            │
│  ROUTING_MAP       → document type → agent/UI mapping          │
└────────────────────────────────────────────────────────────────┘
```

> **Key principle**: Numbers come from math. Text comes from LLMs. Control flow comes from code.

---

## 15. PII Enforcement Fix

### The Contradiction

The original Redis schema stored raw numeric values in the `profile` object:

```json
{ "income": 80000, "savings": 200000, "monthly_expenses": 3500 }
```

These are exact financial figures — **PII by the system's own definition**. Storing them in Redis contradicts the trust-by-design principle.

### PII vs Derived Data — Formal Definition

| Category | Definition | Examples |
|---|---|---|
| **PII** | Any value that could identify or directly characterize a person's finances at a specific point in time | `income: 145000`, `savings: 238500`, `account: 4521...` |
| **Derived / Abstracted** | A label or range computed from a raw value — cannot be reversed to the original | `income_range: "UPPER_MIDDLE"`, `savings_level: "GOOD"` |

### BEFORE — Unsafe Redis Profile Schema

```json
{
  "profile": {
    "name": "Rohan",
    "age": 35,
    "income": 145000,
    "savings": 238500,
    "monthly_expenses": 4200,
    "retirement_age": 60,
    "risk_tolerance": "medium",
    "goals": ["retire at 60"]
  }
}
```

**Problems**: `income`, `savings`, and `monthly_expenses` are exact figures. If Redis is compromised, exact financial data is exposed.

### AFTER — Safe Redis Profile Schema

```json
{
  "profile": {
    "name": "Rohan",
    "age": 35,
    "income_range": "UPPER_MIDDLE",
    "savings_level": "GOOD",
    "expense_level": "MODERATE",
    "retirement_age": 60,
    "risk_tolerance": "medium",
    "goals": ["retire at 60"]
  }
}
```

**Raw values stay in LLM context only** — they are used during the current request to run agents, then discarded. They are never written to Redis, Markdown, or Vector DB.

### Required Code Change — `sanitizeProfile()` Utility

A `sanitizeProfile()` function must be applied in `chat.route.js` and `upload.route.js` before calling `redisMemory.updateSession()`:

```javascript
// utils/pii.sanitizer.js  (to be added)
export function sanitizeProfile(rawProfile) {
  return {
    name:           rawProfile.name          || 'User',
    age:            rawProfile.age           || 0,      // age is not PII in this context
    income_range:   incomeToRange(rawProfile.income || 0),
    savings_level:  savingsLevel(rawProfile.savings || 0),
    expense_level:  expenseLevel(rawProfile.monthly_expenses || 0, rawProfile.income || 0),
    retirement_age: rawProfile.retirement_age || 65,
    risk_tolerance: rawProfile.risk_tolerance || 'medium',
    goals:          rawProfile.goals          || [],
  };
}
```

Then in the route, before saving:
```javascript
// chat.route.js / upload.route.js
if (profile) {
  const safeProfile = sanitizeProfile(profile);  // strip raw numbers
  await redisMemory.updateSession(sessionId, { profile: safeProfile });
  eventEmitter.emitProfileUpdated(sessionId, safeProfile);
}
```

> **Note**: This change requires updating the profile component in Angular to display range labels instead of raw numbers. The simulation agent must also accept range labels or fall back to a numeric estimate derived from the range midpoint.

### Sanitization Thresholds (Reference)

| Raw Field | Sanitizer Function | Output Labels |
|---|---|---|
| `income` | `incomeToRange(income)` | LOW / LOWER_MIDDLE / MIDDLE / UPPER_MIDDLE / HIGH / VERY_HIGH |
| `savings` | `savingsLevel(savings)` | VERY_LOW / LOW / MODERATE / GOOD / HIGH / VERY_HIGH |
| `monthly_expenses` | `expenseLevel(expenses, income)` | VERY_LOW / LOW / MODERATE / HIGH / VERY_HIGH |

---

## 16. Session Atomicity & Concurrency

### Current Behavior — Non-Atomic Writes

The current `updateSession()` in `redis.memory.js` performs a **non-atomic read-modify-write**:

```javascript
async updateSession(sessionId, partial) {
  const existing = await this.getSession(sessionId);   // READ
  const merged = { ...existing, ...partial };           // MODIFY (in-memory)
  await this.saveSession(sessionId, merged);            // WRITE
}
```

**Race condition scenario**:
```
Request A reads session  →  { profile: null, simulation: null }
Request B reads session  →  { profile: null, simulation: null }
Request A writes         →  { profile: {...}, simulation: null }
Request B writes         →  { profile: null,  simulation: {...} }   ← A's profile is LOST
```

This can happen if a user sends two messages in rapid succession, or if the chat and upload routes run concurrently for the same session.

### What Happens if an Agent Fails Mid-Write

With the current `withFallback()` design:
1. Each agent returns an empty patch `{}` on failure
2. Routes only call `updateSession()` if the value is non-null
3. So a failing agent simply produces no write — it does not corrupt existing data
4. Risk is data incompleteness, not corruption

### Fix Option 1 — Optimistic Locking with Version Field

```javascript
async updateSessionAtomic(sessionId, partial) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = await this.getSession(sessionId) || { _version: 0 };
    const expectedVersion = existing._version || 0;

    const merged = {
      ...existing,
      ...partial,
      _version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };

    // Only write if version hasn't changed (WATCH + MULTI/EXEC equivalent via Lua)
    const written = await this._compareAndSet(sessionId, merged, expectedVersion);
    if (written) return merged;

    // Version mismatch — another request updated session, retry
    await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
  }
  throw new Error(`Session ${sessionId} update conflict after ${MAX_RETRIES} retries`);
}

// Lua script: atomic compare-and-set
async _compareAndSet(sessionId, newValue, expectedVersion) {
  const script = `
    local current = redis.call('GET', KEYS[1])
    if current == false then
      redis.call('SETEX', KEYS[1], ARGV[2], ARGV[1])
      return 1
    end
    local data = cjson.decode(current)
    if (data._version or 0) == tonumber(ARGV[3]) then
      redis.call('SETEX', KEYS[1], ARGV[2], ARGV[1])
      return 1
    end
    return 0
  `;
  const result = await this.client.eval(
    script, 1,
    `session:${sessionId}`,
    JSON.stringify(newValue),
    this.ttl,
    String(expectedVersion),
  );
  return result === 1;
}
```

### Fix Option 2 — Per-Session Mutex (Simpler, No Lua Required)

```javascript
// In-memory mutex map (works for single-process; use Redis SET NX for multi-process)
const sessionLocks = new Map();

async updateSessionSafe(sessionId, partial) {
  // Wait for any existing lock on this session
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId);
  }

  let resolve;
  const lock = new Promise(r => { resolve = r; });
  sessionLocks.set(sessionId, lock);

  try {
    const existing = await this.getSession(sessionId) || {};
    const merged = { ...existing, ...partial, updatedAt: new Date().toISOString() };
    await this.saveSession(sessionId, merged);
    return merged;
  } finally {
    sessionLocks.delete(sessionId);
    resolve();
  }
}
```

### Practical Impact Assessment

| Scenario | Risk without fix | Risk with mutex |
|---|---|---|
| Two rapid chat messages | Profile from first message overwritten by second | Serialized — both writes succeed in order |
| Chat + upload simultaneously | One write lost | Serialized — both complete |
| Agent fails mid-pipeline | No write (safe) | No change — already safe |
| Backend restarted | In-memory mutex lost | No stale locks — clean state |

> **Current status**: The mutex is not yet implemented. For a single-user POC with sequential requests, the race condition is unlikely to trigger. For production multi-user usage, `updateSessionSafe()` must replace `updateSession()`.

---

## 17. Vector DB Isolation Guarantees

### How sessionId is Enforced on WRITE

Every document stored in ChromaDB includes `sessionId` in its metadata:

```javascript
// vector.store.js — storeSessionSnapshot()
await this.add(id, markdownContent, { sessionId, type: 'session_snapshot' });

// vector.store.js — add()
await this.collection.add({
  ids:        [id],
  embeddings: [vector],
  documents:  [text],
  metadatas:  [{ sessionId, type: 'session_snapshot' }],  // ← sessionId always present
});
```

**Enforcement**: `sessionId` is a required parameter in `storeSessionSnapshot()`. There is no public method to store without a sessionId.

### How sessionId is Enforced on READ

Every query passes `where: { sessionId }` when a sessionId is available:

```javascript
// vector.store.js — search()
if (sessionId) queryParams.where = { sessionId };
const results = await this.collection.query(queryParams);
```

**The gap**: `sessionId` is optional — `search(query, null)` returns results **across all sessions**. This is the cross-session data leak risk.

### Failure Scenario — Filter Missed

```javascript
// UNSAFE: called without sessionId
const ragContext = await vectorStore.searchAsContext(message);
// Returns documents from ALL sessions — user A can see user B's financial context
```

This would happen if a developer adds a new route and forgets to pass `sessionId`.

### Mitigation — Strict Wrapper Enforcing sessionId

Add a `searchForSession()` method that makes `sessionId` mandatory:

```javascript
// vector.store.js (proposed addition)
async searchForSession(query, sessionId) {
  if (!sessionId) throw new Error('VectorStore.searchForSession: sessionId is required');
  return this.searchAsContext(query, sessionId);
}
```

Replace all calls in routes with `searchForSession()` instead of `searchAsContext()`:
```javascript
// chat.route.js
const ragContext = await vectorStore.searchForSession(message, sessionId);  // throws if no sessionId

// upload.route.js
const ragContext = await vectorStore.searchForSession(`financial document ${fileName}`, sessionId);
```

### Collection Strategy

Currently all sessions share **one collection** (`financial_memory` / `financial_planning`), isolated by metadata filter. An alternative is **per-session collections**:

| Strategy | Current | Alternative |
|---|---|---|
| **Isolation mechanism** | `where: { sessionId }` metadata filter | Separate collection per session |
| **Risk of cross-contamination** | Developer forgets filter | Zero — separate namespace |
| **Cleanup** | Must delete by filter | `client.deleteCollection(sessionId)` |
| **Scale** | One collection, N sessions | N collections |
| **ChromaDB limit** | Not a concern for POC | Collections have overhead at scale |

> **Recommendation for production**: Per-session collections eliminate the filter-miss risk entirely. For current POC scale, the metadata filter with the mandatory wrapper is sufficient.

### In-Memory Fallback Isolation

The fallback array applies the same filter:
```javascript
const pool = sessionId
  ? this._fallbackDocs.filter((d) => d.metadata?.sessionId === sessionId)
  : this._fallbackDocs;
```

Same gap: if `sessionId` is null, all docs are returned. The `searchForSession()` wrapper fixes this path too.

---

## 18. Planner Decision Deep Dive

### Full Decision Flow

```
User message
    │
    ▼
Step 1 — Context injection
    │   profileExists = session.profile ? "yes" : "no"
    │   simulationExists = session.simulation ? "yes" : "no"
    │   sessionContext = last N conversation turns
    │
    ▼
Step 2 — LLM reasoning (non-deterministic)
    │   Prompt rules applied by LLM:
    │   • "Is this first message?" → include profile
    │   • "Did user mention retirement/savings goals?" → include simulation
    │   • "Did user ask about investments?" → include portfolio (needs simulation)
    │   • "Did user mention taxes?" → include tax (needs taxInsights)
    │   • "Did user mention spending/budget?" → include cashflow
    │   • "Is intent clear?" → set confidence = high|medium|low
    │
    ▼
Step 3 — Guardrails (deterministic, in PlannerAgent code)
    │   • explanation missing → append it
    │   • portfolio present, simulation absent → inject simulation before portfolio
    │   • risk present, portfolio absent → inject portfolio → simulation
    │
    ▼
Step 4 — Output: final plan object
```

### Mandatory Agent Rules (Hard-Coded in `planner.agent.js`)

These rules run **after** the LLM output — the LLM cannot override them:

```javascript
// 1. Explanation is always the last agent
if (!agents.includes('explanation')) agents.push('explanation');

// 2. Portfolio requires simulation (portfolio allocation needs projection data)
if (agents.includes('portfolio') && !agents.includes('simulation')) {
  agents.splice(agents.indexOf('portfolio'), 0, 'simulation');
}

// 3. Risk requires portfolio (risk scoring needs allocation data)
if (agents.includes('risk') && !agents.includes('portfolio')) {
  const riskIdx = agents.indexOf('risk');
  if (!agents.includes('simulation')) agents.splice(riskIdx, 0, 'simulation');
  agents.splice(agents.indexOf('risk'), 0, 'portfolio');
}
```

### Optional Agent Logic

These agents are included only when the LLM decides context warrants them AND the required data exists:

| Agent | LLM condition | Code guard in graph node |
|---|---|---|
| `tax` | Message mentions taxes, deductions, or optimization | `if (!taxInsights) return {}` — skips if no insights loaded |
| `cashflow` | Message mentions spending, budget, monthly cash | `if (!cashflowInsights) return {}` — skips if no insights loaded |
| `portfolio` | Message mentions investments or allocation | Requires simulation to have run first |
| `risk` | Message mentions risk, volatility, or market exposure | Requires portfolio to have run first |

### Missing Data Handling

The planner returns a `missing_data[]` array listing document types that would improve the analysis. This is surfaced to the user in the API response `meta.missing_data`:

```json
{
  "meta": {
    "missing_data": ["tax_document", "bank_statement"],
    "confidence": "medium",
    "decision_rationale": "Profile extracted from chat only — uploading a bank statement would improve cashflow analysis."
  }
}
```

**The system does not block on missing data.** It proceeds with whatever is available and communicates gaps to the user.

### Full Decision Example

**User message**: `"What's my retirement outlook and should I be worried about taxes?"`

```
Step 1 — Context:
  profileExists = "yes"  (prior session)
  simulationExists = "yes"
  sessionContext = "User: Can I retire at 55? Assistant: Based on your profile..."

Step 2 — LLM reasoning:
  "retirement outlook" → include simulation
  "worried about taxes" → include tax
  profile already exists → omit profile (no new personal info shared)
  taxInsights exist in session (user uploaded W2 last week) → tax agent can run

Step 3 — Guardrails:
  simulation already present → OK
  tax present → no dependency issue (tax only needs taxInsights)
  explanation missing → append

Step 4 — Final plan:
  {
    intent: "Retirement projection + tax efficiency review",
    required_agents: ["simulation", "tax", "explanation"],
    optional_agents: ["portfolio"],
    missing_data: [],
    confidence: "high",
    decision_rationale: "Simulation for retirement outlook; tax included because user explicitly asked and taxInsights are available from prior upload.",
    agents: ["simulation", "tax", "explanation"],
    ui: [simulation_chart, tax_panel, explanation_panel]
  }
```

---

## 19. Data Lifecycle & Retention

### Lifecycle Diagram

```
Document Upload / Chat Message
    │
    ▼
┌──────────────────────────────────────────────┐
│  IN-MEMORY (transient — current request only) │
│  • Raw document text                          │
│  • LLM raw_values (grossIncome, etc.)         │
│  • LangGraph state object                     │
│  Lifetime: single HTTP request (~30-60s)      │
└──────────────────────────────────────────────┘
    │ sanitized signals only
    ▼
┌──────────────────────────────────────────────┐
│  REDIS  session:{sessionId}                  │
│  Lifetime: TTL (default 1 hour)              │
│  Extended: on every updateSession() call     │
│  Cleared: TTL expiry OR DELETE /api/session  │
└──────────────────────────────────────────────┘
    │ abstracted summaries only
    ▼
┌──────────────────────────────────────────────┐
│  MARKDOWN  data/sessions/{sessionId}.md       │
│  Lifetime: indefinite (no auto-cleanup)       │
│  Cleared: manual deletion only               │
│  Risk: grows unbounded; contains abstractions │
└──────────────────────────────────────────────┘
    │ anonymized summaries only
    ▼
┌──────────────────────────────────────────────┐
│  VECTOR DB  ChromaDB collection              │
│  Lifetime: indefinite (no auto-cleanup)      │
│  Cleared: manual DELETE by sessionId filter  │
│  Risk: grows unbounded; contains summaries   │
└──────────────────────────────────────────────┘
```

### Retention Policy (Current vs Recommended)

| Store | Current | Recommended for Production |
|---|---|---|
| Redis | 1-hour TTL | Configurable per tier; extend on activity; hard cap at 30 days |
| Markdown files | Never deleted | Delete when Redis key expires (use Redis keyspace notifications) |
| Vector embeddings | Never deleted | Delete when Redis key expires |
| In-memory (request) | GC'd at request end | No change needed |

### User-Triggered Delete Flow

When a user triggers session reset (frontend "Reset" button or `DELETE /api/session/:id`):

```
1. DELETE /api/session/:sessionId
       │
       ├─→ redisMemory.deleteSession(sessionId)
       │     → redis DEL session:{sessionId}
       │
       ├─→ Delete markdown file
       │     → fs.unlinkSync(`data/sessions/${sessionId}.md`)
       │
       └─→ Delete vector embeddings
             → collection.delete({ where: { sessionId } })
```

> **Current status**: The backend `DELETE /api/session/:sessionId` endpoint exists but only deletes the Redis key. Markdown and vector cleanup are **not implemented**. This is a gap for production use.

### Redis Keyspace Notification Approach (Recommended)

Configure Redis to emit keyspace events on key expiry, then subscribe in the backend to cascade cleanup:

```javascript
// index.js — subscribe to Redis expiry events
redisClient.subscribe('__keyevent@0__:expired', (key) => {
  if (key.startsWith('session:')) {
    const sessionId = key.replace('session:', '');
    // Cascade cleanup
    fs.unlink(`data/sessions/${sessionId}.md`, () => {});
    vectorStore.collection?.delete({ where: { sessionId } }).catch(() => {});
    log.info(`Session ${sessionId} expired — markdown + vector cleanup triggered`);
  }
});
```

---

## 20. Trust Boundaries

### Where Raw Financial Data is Allowed

```
┌──────────────────────────────────────────────────────────────────┐
│  ALLOWED ZONE — Raw data exists here temporarily                  │
│                                                                    │
│  1. multer memoryStorage buffer                                    │
│     (req.file.buffer — raw document bytes)                        │
│                                                                    │
│  2. documentText variable in upload.route.js                      │
│     (buffer.toString('utf-8') — raw text, single request scope)  │
│                                                                    │
│  3. LLM prompt sent to Ollama/OpenAI                              │
│     (documentText included in prompt — leaves process boundary)  │
│                                                                    │
│  4. LLM raw_values in DocumentIngestionAgent                      │
│     (result.raw_values — grossIncome, SSN patterns — in-memory)  │
│                                                                    │
│  5. profile agent output (profile.income, profile.savings)        │
│     (in graph state — used for simulation, NOT written to Redis)  │
└──────────────────────────────────────────────────────────────────┘
```

### Where Raw Financial Data is Strictly Forbidden

```
┌──────────────────────────────────────────────────────────────────┐
│  FORBIDDEN ZONE — Raw data must never appear here                 │
│                                                                    │
│  ✗  Redis session store                                           │
│     → Only range labels and abstracted agent outputs              │
│                                                                    │
│  ✗  Markdown memory files (data/sessions/)                       │
│     → Only labels: "Income Range: UPPER_MIDDLE"                   │
│                                                                    │
│  ✗  ChromaDB vector store                                        │
│     → Only anonymized summaries; no amounts, no account numbers   │
│                                                                    │
│  ✗  Application logs                                              │
│     → redactDocument() must be applied before logging any text   │
│                                                                    │
│  ✗  HTTP response body                                            │
│     → data.profile must contain sanitized fields only            │
│                                                                    │
│  ✗  WebSocket events                                              │
│     → Events emit sanitized objects only                          │
└──────────────────────────────────────────────────────────────────┘
```

### Enforcement Strategy

| Boundary | Current enforcement | Gap |
|---|---|---|
| multer → disk | `memoryStorage()` — no disk write | None |
| raw_values → Redis | `sanitizeTaxInsights()` / `sanitizeCashflowInsights()` called before any persist | Profile agent raw numbers still written to Redis (see Section 15) |
| documentText → logs | `redactDocument()` exists but not called in logging paths | Not enforced on debug logs |
| profile → Redis | No `sanitizeProfile()` applied before save | **Gap — must be fixed** |
| vector store | Anonymized summaries only | Content depends on what markdown is passed — abstraction maintained if markdown is correct |

### Trust Boundary Enforcement Point Map

```
Upload request
    │
    ├─→ [BOUNDARY 1] multer memoryStorage
    │     Raw bytes contained — no disk write
    │
    ├─→ [BOUNDARY 2] DocumentIngestionAgent
    │     raw_values extracted → sanitized → raw_values discarded
    │     ENFORCED by: sanitizeTaxInsights() / sanitizeCashflowInsights()
    │
    ├─→ [BOUNDARY 3] Profile sanitizer (GAP — not yet applied)
    │     profile.income/savings/monthly_expenses → must be range labels
    │     REQUIRED: sanitizeProfile() before updateSession()
    │
    └─→ [BOUNDARY 4] Storage writes
          Redis: sanitized objects only
          Markdown: MarkdownMemory.write() formats to labels
          Vector: anonymized summary strings
```

---

## 21. Concurrency & Event Ordering

### Are Agents Sequential or Parallel?

**Strictly sequential.** LangGraph `StateGraph` executes one node at a time. Each node must complete before the routing function runs and the next node starts. There is no parallel agent execution.

```
node_planner STARTS
node_planner ENDS
    → routing function runs
node_profile STARTS
node_profile ENDS
    → routing function runs
node_simulation STARTS
... and so on
```

**Why sequential?** Each agent depends on the previous agent's output. `portfolio` needs `simulation` results. `risk` needs `portfolio` results. Parallel execution would require agents to run on different inputs, which doesn't fit the data dependency chain.

### Concurrency at the Request Level

Multiple users (or the same user sending rapid messages) create **separate graph invocations** that run concurrently at the Node.js process level:

```
User A request → financialGraph.invoke(stateA) ─────────────────→ done
User B request → financialGraph.invoke(stateB) ──────────────→ done
User A 2nd msg → financialGraph.invoke(stateA2) ───────────────────→ done
```

Each invocation has its own isolated state object — there is no shared mutable state in the graph itself. The only shared resource is Redis, where the session atomicity issue described in Section 16 applies.

### WebSocket Event Ordering Guarantees

Events are emitted in the order agents complete, which is deterministic:

```
AGENT_STARTED:planner
PLANNER_DECIDED
AGENT_COMPLETED:planner
AGENT_STARTED:profile
PROFILE_UPDATED         ← emitted after Redis write succeeds
AGENT_COMPLETED:profile
AGENT_STARTED:simulation
SIMULATION_UPDATED
AGENT_COMPLETED:simulation
...
EXPLANATION_READY
```

**Ordering guarantees**:

| Guarantee | Mechanism |
|---|---|
| Events for a session arrive in agent-completion order | Sequential graph execution — only one agent running at a time |
| `PROFILE_UPDATED` fires after Redis write | `emitProfileUpdated()` called after `updateSession()` resolves |
| Events from different sessions do not interleave incorrectly | Each WS connection filters by `sessionId` |

**No guarantee**:

| Non-guarantee | Reason |
|---|---|
| Event delivery order on the network | TCP is ordered per-connection, but the WS framework could buffer/reorder |
| Events arrive before HTTP response | WS events are fire-and-forget; HTTP response waits for full pipeline |

### What Happens if Two Requests Hit the Same Session Simultaneously

```
Timeline:
  T=0ms  Request A (chat: "Can I retire?") → graph starts
  T=50ms Request B (upload: W2.txt)        → graph starts (separate invocation)
  T=8s   Request A profile node done       → updateSession({ profile })
  T=9s   Request B profile node done       → updateSession({ profile })  ← may overwrite A's profile
  T=12s  Request A simulation done         → updateSession({ simulation })
  T=15s  Request B tax node done           → updateSession({ tax })
  T=20s  Both complete — final Redis state depends on write order
```

**Result**: Non-deterministic final state. The last write wins on each key. As described in Section 16, a per-session mutex or optimistic locking is required to prevent this.

### Summary Table

| Property | Value |
|---|---|
| Agents run in parallel? | No — strictly sequential per request |
| Requests run in parallel? | Yes — Node.js handles concurrent requests |
| Shared state between requests? | Only Redis (race condition exists — see Section 16) |
| WebSocket event order | Guaranteed per session (sequential agent completion) |
| Graph state isolation | Complete — each invocation has its own state object |

> **Note**: The HTTP response is still the primary data source for UI rendering. WebSocket events are currently wired for loading indicators. Connecting them to the `DynamicRendererComponent` for progressive rendering is the next architectural enhancement.

---

## 22. Hybrid Compute Layer (ReactiveEngine + StateManager)

### Overview

The reactive compute layer sits between the agent pipeline and the memory layer. It has two responsibilities:

1. **StateManager** — per-session in-process state store so every compute function always has the latest upstream data
2. **ReactiveEngine** — listens for upstream events and automatically re-computes downstream agents without any LLM calls

### StateManager

**File**: `backend/engine/state.manager.js`

A singleton `Map<sessionId → state>` that holds `{ profile, simulation, portfolio, risk, tax, cashflow }` per session.

| Method | Description |
|---|---|
| `get(sessionId)` | Returns current state (empty state shape if not found) |
| `update(sessionId, patch)` | Atomic merge — only keys in patch are overwritten |
| `seed(sessionId, session)` | Populate from a Redis session object on first load |
| `clear(sessionId)` | Remove all state (call on session expiry) |

**Why it exists**: Compute functions need the complete current state to re-compute downstream values. Without StateManager, `recomputeRisk()` would not know the current portfolio after a glide-path shift.

**Usage in routes**:
```javascript
// chat.route.js + upload.route.js — after loading Redis session
reactiveEngine.seedFromSession(sessionId, session);
```

### ReactiveEngine

**File**: `backend/engine/reactive.engine.js`

Attaches listeners to `AppEventEmitter` at startup and executes deterministic cascades when upstream data changes.

#### Dependency Map

```
PROFILE_UPDATED    → [simulation, portfolio, risk]
TAX_UPDATED        → [simulation]
CASHFLOW_UPDATED   → [simulation]
SIMULATION_UPDATED → [portfolio, risk]
PORTFOLIO_UPDATED  → [risk]
```

#### Cascade Execution Rules

1. Agents in the cascade run **sequentially** — each sees the updated state from the previous step
2. Each recompute calls the pure-function compute module directly (no LLM, no chain invocation)
3. Results are written to **both StateManager and Redis** for durability
4. After each recompute a downstream event is emitted → WS clients receive real-time updates

#### What is preserved vs recomputed

| Field | ReactiveEngine action |
|---|---|
| Simulation numbers (projectedSavings, gap, milestones) | **Recomputed** from profile |
| Simulation `summary` text | **Preserved** — not re-generated without LLM |
| Portfolio allocation % | **Recomputed** from profile + simulation |
| Portfolio `rationale` text | **Preserved** — not re-generated without LLM |
| Risk score + stress tests | **Recomputed** from profile + portfolio + simulation |
| Risk `factors[]` + `mitigation_steps[]` text | **Preserved** — not re-generated without LLM |

#### E2E Example: User updates income (PROFILE_UPDATED fires)

```
1. ProfileAgent saves new profile to Redis
2. chat.route.js emits PROFILE_UPDATED
3. ReactiveEngine.cascade("session-123", PROFILE_UPDATED, [simulation, portfolio, risk])

   Step A: recomputeSimulation(state)
     → calculateRetirementProjection(newProfile)
     → new projected_savings, milestones, savings_gap
     → StateManager.update({ simulation: newSim })
     → Redis.updateSession({ simulation: newSim })
     → emit SIMULATION_UPDATED → WS client sees updated chart

   Step B: recomputePortfolio(state)   ← uses updated simulation
     → computePortfolioAllocation(newProfile, newSim)
     → new allocation, strategy, expected_return
     → StateManager.update({ portfolio: newPortfolio })
     → Redis.updateSession({ portfolio: newPortfolio })
     → emit PORTFOLIO_UPDATED → WS client sees updated allocation

   Step C: recomputeRisk(state)        ← uses updated simulation + portfolio
     → computeRiskScore(newProfile, newPortfolio, newSim)
     → new overall_risk_score, risk_level, stress_tests
     → StateManager.update({ risk: newRisk })
     → Redis.updateSession({ risk: newRisk })
     → emit RISK_UPDATED → WS client sees updated risk dashboard
```

Total LLM calls for this cascade: **0**.

---

## 23. Pure-Function Compute Modules

### financial.calculator.js

**File**: `backend/utils/financial.calculator.js`

Produces retirement projection numbers using compound interest math.

| Output | Formula |
|---|---|
| `projected_savings_at_retirement` | `FV_lump_sum(savings, 7%, n) + FV_annuity(annual_savings, 7%, n)` |
| `required_savings_at_retirement` | `annual_expenses × 25` (4% SWR / 25× rule) |
| `savings_gap` | `max(0, required − projected)` |
| `monthly_shortfall_or_surplus` | `(projected × 4%) / 12 − monthly_expenses` |
| `years_of_runway` | `projected / annual_expenses` |
| `milestones[3]` | Savings at 1/3, 2/3, and full years-to-retirement intervals |

**Assumptions** (documented in code):
- Annual return: 7% (long-term S&P 500 average, inflation-adjusted)
- Safe Withdrawal Rate: 4% (25× rule)

---

### portfolio.compute.js

**File**: `backend/agents/compute/portfolio.compute.js`

Produces asset allocation, strategy label, expected return, and rebalance frequency.

**Input**: `profile.risk_tolerance`, `profile.age`, `profile.retirement_age`

**Algorithm**:
```
1. Look up base allocation from risk_tolerance → BASE_ALLOCATIONS map
2. If years_to_retirement ≤ 10: shift equities → bonds (glide path)
3. If years_to_retirement ≤ 5:  shift further (near-retirement path)
4. Normalise to exactly 100%
5. expected_return = (equities/100) × 9% + (bonds/100) × 3%
6. strategy = aggressive | balanced | conservative | very_conservative
7. rebalance_frequency = quarterly (≤5 yrs) | annually
```

| Risk Tolerance | Equities | Bonds | Real Estate | Cash |
|---|---|---|---|---|
| `low` | 30% | 55% | 5% | 10% |
| `medium` | 60% | 30% | 5% | 5% |
| `high` | 80% | 12% | 5% | 3% |

---

### risk.compute.js

**File**: `backend/agents/compute/risk.compute.js`

Produces risk score, risk level, and stress test estimates.

**Input**: `profile.age`, `profile.retirement_age`, `portfolio.allocation`, `simulation.savings_gap`, `simulation.projected_savings_at_retirement`

**Scoring factors**:

| Factor | Score 0 | Score 1 | Score 2 | Score 3 | Weight |
|---|---|---|---|---|---|
| Equity concentration | — | equity < 55% | equity 55–74% | equity ≥ 75% | ×2 |
| Time horizon | > 20 yrs | 11–20 yrs | 6–10 yrs | ≤ 5 yrs | ×2 |
| Savings gap | $0 | > $0 | ≥ $100k | ≥ $500k | ×3 |

```
raw_score = equity×2 + time×2 + gap×3         (max = 21)
score     = round( raw_score / 21 × 10 )       (range: 1–10)
risk_level:   1–3 → low, 4–5 → medium, 6–7 → high, 8–10 → very high
```

**Stress tests**:
```
market_crash_20pct_impact = -(projected_savings × equity% × 0.20)
inflation_spike_impact    = -(projected_savings × 0.05)
```

All values are integers in dollars. The LLM receives these as context when writing factor descriptions but cannot change them.

---

## 24. A2UI v2 — Agent-to-UI Orchestration

### Overview

A2UI (Agent-to-UI) is the protocol by which the backend controls the full rendering contract for every UI panel. In v2, the `ui` field in API responses is no longer a flat list of `{type}` strings — it is a rich schema where the server pre-answers four questions per panel:

| Question | Field(s) | Who answers |
|----------|----------|-------------|
| **WHAT** to show | `type` | Planner (LLM) |
| **WHY** it is shown | `insight.reason`, `insight.summary`, `insight.confidence` | Planner `panel_reason` → UIComposer |
| **HOW** to show it | `meta.priority`, `meta.layout`, `meta.stage`, `meta.behavior` | UIComposer (component registry) |
| **WHEN** to refresh | `meta.trigger` | UIComposer (component registry) |

### A2UI v2 Schema

```typescript
interface A2UIComponent {
  id:   string;         // stable per request: "{type}-{position}"
  type: string;         // component identifier: "simulation_chart", "tax_panel", etc.
  data: Record<string, unknown>;   // pre-fetched state slice for this component

  meta: {
    priority:    'high' | 'medium' | 'low';
    layout:      'full_width' | 'half' | 'sidebar';
    position:    number;
    trigger:     string | null;   // WebSocket event that refreshes this panel
    stage:       'summary' | 'detailed' | 'recommendation';
    behavior: {
      expandOnLoad: boolean;
      interactive:  boolean;
    };
  };

  insight: {
    reason:     string;   // WHY the panel is shown (from planner rationale)
    summary:    string;   // WHAT the data shows (derived from state)
    confidence: number;   // 0.0–1.0
  };

  actions: { label: string; action: string }[];
}
```

### UIComposer — `backend/engine/ui.composer.js`

The UIComposer is a deterministic function — no LLM, no async, no randomness:

```javascript
composeUI(plan, state) → A2UIComponent[]
```

**Inputs**:
- `plan` — planner output with `{ui[], confidence, decision_rationale}`
- `state` — current session state `{profile, simulation, portfolio, risk, tax, cashflow}`

**Steps per component**:
1. Look up `REGISTRY[type]` → static display rules
2. Call `extractData(type, state)` → pull the relevant state slice
3. Call `buildInsight(type, plan, state)` → derive reason + summary from state
4. Assemble the final A2UIComponent object

**Component registry (hardcoded, never changes at runtime)**:

```javascript
const REGISTRY = {
  profile_summary:   { priority: 'high',   layout: 'half',       trigger: 'PROFILE_UPDATED',    expandOnLoad: false, interactive: false },
  simulation_chart:  { priority: 'high',   layout: 'full_width', trigger: 'SIMULATION_UPDATED', expandOnLoad: true,  interactive: true  },
  portfolio_view:    { priority: 'medium', layout: 'half',       trigger: 'PORTFOLIO_UPDATED',  expandOnLoad: false, interactive: true  },
  risk_dashboard:    { priority: 'medium', layout: 'half',       trigger: 'RISK_UPDATED',       expandOnLoad: false, interactive: false },
  tax_panel:         { priority: 'high',   layout: 'full_width', trigger: 'TAX_UPDATED',        expandOnLoad: true,  interactive: false },
  cashflow_panel:    { priority: 'medium', layout: 'full_width', trigger: 'CASHFLOW_UPDATED',   expandOnLoad: false, interactive: false },
  explanation_panel: { priority: 'high',   layout: 'full_width', trigger: 'EXPLANATION_READY',  expandOnLoad: true,  interactive: false },
}
```

### Insight builders — state-derived summaries

Each component has a dedicated insight builder that derives a human-readable summary from the current state. This is deterministic (not LLM):

| Component | Insight summary example |
|-----------|------------------------|
| `simulation_chart` | `"On track — $2.86M projected vs $1.05M required"` |
| `profile_summary` | `"Alex, age 35 — target retirement at 65 (30 years away)"` |
| `portfolio_view` | `"Balanced strategy — 60% equities, 6.6% expected annual return"` |
| `risk_dashboard` | `"Risk score 5/10 (medium) — $144k exposed in 20% market crash"` |
| `tax_panel` | `"22% bracket — efficiency 7/10, 3 optimization strategies identified"` |
| `cashflow_panel` | `"Good budget health — MODERATE savings rate, spending level ELEVATED"` |

### Session persistence

After each pipeline run, `uiContext` (the full A2UIComponent array) is persisted to Redis:

```javascript
await redisMemory.updateSession(sessionId, { uiContext: richUI });
```

This means the frontend can reconstruct the last rendered state on page refresh without re-running the pipeline.

### Frontend contract

The Angular frontend treats the A2UI v2 array as a **read-only rendering contract**. It does not:
- Decide which panels to show (server decides)
- Compute layout or priority (registry decides)
- Fetch data for panels (data is pre-fetched in `comp.data`)

The `DynamicRendererComponent` renders each component using `comp.data` directly and surfaces `comp.insight.reason` as the "Why am I seeing this?" tooltip per panel.

### UI consistency — no partial state

The two-phase compose approach prevents partial renders:

```
Phase 1 (immediate): composeLoadingState(plan)
  → loading:true, data:{}, confidence:0
  → Frontend renders skeletons, no flicker

Phase 2 (after agents): composeUI(plan, state)
  → loading:false, data:filled, version:N
  → Frontend swaps skeletons for real panels (atomic by version check)
```

The client stores `lastSeenVersion` and rejects any A2UI payload where `component.version < lastSeenVersion`.

### Adding a new panel (zero frontend changes)

1. Add the component to `REGISTRY` in `ui.composer.js`
2. Add a case in `buildInsight()` for the insight summary
3. Add a case in `extractData()` for the data slice
4. The planner prompt already lists all available panels — add the new type to that list
5. Deploy backend only

The frontend will render the new panel automatically since it maps `type → Angular component` and the Angular component for that type already exists (or is added in a separate frontend PR).

---

## 25. Priority Event Queue

### File: `backend/engine/priority.queue.js`

### Purpose

The PriorityQueue prevents two failure modes:
1. **Overlapping cascades** — a PORTFOLIO_UPDATED cascade running while a PROFILE_UPDATED cascade is already active for the same session would produce an inconsistent intermediate state
2. **Duplicate cascade waste** — 3 rapid PROFILE_UPDATED events for the same session should produce exactly 1 cascade, not 3

### Priority levels

```javascript
export const PRIORITY = { HIGH: 1, MEDIUM: 2, LOW: 3 };

export const EVENT_PRIORITY = {
  PROFILE_UPDATED:    1,  // HIGH  — income/age change affects everything
  TAX_UPDATED:        2,  // MEDIUM
  CASHFLOW_UPDATED:   2,  // MEDIUM
  PORTFOLIO_UPDATED:  2,  // MEDIUM
  SIMULATION_UPDATED: 2,  // MEDIUM
  EXPLANATION_READY:  3,  // LOW
  AGENT_STARTED:      3,  // LOW
  AGENT_COMPLETED:    3,  // LOW
};
```

### Deduplication (coalescing)

```javascript
enqueue(event, sessionId, payload, priority):
  key = `${event}:${sessionId}`
  if key in _map:
    // Merge — do not add a second entry
    _map[key].payload   = { ..._map[key].payload, ...payload }
    _map[key].updatedAt = Date.now()
    return
  entry = { event, sessionId, payload, priority, insertedAt: now() }
  _map[key] = entry
  _queue.push(entry)

drain() → sorted by priority ASC, insertedAt ASC → clears queue and dedup map
peek()  → returns next item without removing
```

### Integration with ReactiveEngine

```
Event fires for sessionId
  ↓
_pendingCascades.has(sessionId)?
  YES → _queue.enqueue(event, sessionId, payload, priority)  ← coalesced if duplicate
  NO  → _runCascade(sessionId, event, downstream, recomputeType)
          ↓
        _pendingCascades.set(sessionId, event)
        await _cascade(...)
        drain queue for this session → run remaining events (HIGH-first)
        _pendingCascades.delete(sessionId)
```

### Conflict resolution with priority

If `PROFILE_UPDATED` (HIGH) and `TAX_UPDATED` (MEDIUM) are both queued while a cascade runs:

```
drain() → sorted: [PROFILE_UPDATED(1), TAX_UPDATED(2)]
          PROFILE_UPDATED runs first → FULL cascade
          TAX_UPDATED runs second → PARTIAL cascade (simulation only)
```

This ensures high-priority full cascades always precede partial ones.

---

## 26. Conflict Resolution

### File: `backend/engine/conflict.resolver.js`

### Purpose

When the same profile field is provided by multiple sources (e.g. user typed "income is 80k" in chat AND uploaded a W-2), a deterministic algorithm decides which value wins. No LLM involvement in this decision.

### Source precedence table

| Source | Rank | Typical scenario |
|--------|------|-----------------|
| `document_extracted` | 4 | Field value from an uploaded tax return or bank statement |
| `user_stated` | 3 | User explicitly said "I make $80k" in chat |
| `inferred` | 2 | LLM extracted from ambiguous text ("decent salary") |
| `default` | 1 | System fallback / placeholder when no data exists |

**Tie-breaking** (when ranks are equal):
1. Higher `confidence` (0.0–1.0) wins
2. If confidence equal, most recent `timestamp` wins

### resolveField — field-level decision

```javascript
resolveField("income", [
  { value: 80000, source: "user_stated",        confidence: 0.75, timestamp: T-60s },
  { value: 95000, source: "document_extracted", confidence: 1.00, timestamp: T-now },
])
// → { value: 95000, source: "document_extracted" }
// document_extracted rank (4) > user_stated rank (3)
```

### mergeProfiles — full profile merge

Iterates every field in the incoming object, resolves each against the existing value (conservatively treated as `inferred` rank), returns a clean merged profile.

```javascript
existing = { income: 80000, age: 35, risk_tolerance: "medium" }
incoming = { income: 95000, savings: 200000 }  // from document upload

mergeProfiles(existing, incoming, "document_extracted")
→ { income: 95000, age: 35, risk_tolerance: "medium", savings: 200000 }
//  ↑ document wins    ↑ preserved               ↑ added
```

### scoreDataQuality — 0.0–1.0 completeness score

```
Full profile fields: [name, age, income, retirement_age, current_savings, monthly_savings, risk_tolerance]
Base deduction: 1/7 ≈ 0.143 per missing field
Extra deduction: 0.15 for each missing critical field (income, retirement_age)

Examples:
  All 7 fields present → 1.0
  Missing income only  → 1.0 - 0.143 - 0.15 = 0.707
  Missing both critical → 1.0 - 2×(0.143 + 0.15) = 0.414
```

Score is surfaced as `insight.confidence` on A2UI v2 panels.

### Event emitted after conflict resolution

```javascript
eventEmitter.emitConflictResolved(sessionId, "income", winner, loser)
// → CONFLICT_RESOLVED event (priority: LOW) → logged; not cascaded
```

---

## 27. Full vs Partial Recompute

### Decision table

| Trigger Event | Recompute Type | Downstream | Reason |
|---------------|---------------|------------|--------|
| `PROFILE_UPDATED` | **FULL** | simulation → portfolio → risk | Age/income/savings change affects all projections |
| `TAX_UPDATED` | **PARTIAL** | simulation only | Tax signals adjust effective savings rate assumption |
| `CASHFLOW_UPDATED` | **PARTIAL** | simulation only | Spending patterns affect monthly surplus calculation |
| `SIMULATION_UPDATED` | **PARTIAL** | portfolio → risk | New savings gap changes allocation and risk score |
| `PORTFOLIO_UPDATED` | **PARTIAL** | risk only | Equity % change → risk score formula input changes |

### Why FULL vs PARTIAL matters

A FULL cascade re-runs all three compute functions sequentially:
```
simulation (~1ms) → portfolio (~1ms) → risk (~1ms)
total: ~3ms, 3 StateManager.update() calls, 3 Redis writes, 3 WebSocket pushes
```

A PARTIAL cascade (e.g. PORTFOLIO_UPDATED) runs only risk:
```
risk (~1ms)
total: ~1ms, 1 StateManager.update(), 1 Redis write, 1 WebSocket push
```

Partial recomputes avoid unnecessary computation. For example, a TAX_UPDATED event should not re-run portfolio allocation since tax signals don't affect the glide-path formula.

### Logging

Every cascade logs its type:
```
[ReactiveEngine] PROFILE_UPDATED → FULL cascade | agents=[simulation, portfolio, risk] session=abc-123
[ReactiveEngine] ✔ simulation recomputed (1ms)
[ReactiveEngine] ✔ portfolio recomputed (1ms)
[ReactiveEngine] ✔ risk recomputed (1ms)

[ReactiveEngine] TAX_UPDATED → PARTIAL cascade | agents=[simulation] session=abc-123
[ReactiveEngine] ✔ simulation recomputed (1ms)
```

The millisecond times confirm deterministic math (not LLM — which takes hundreds of ms).

### StateManager version tracking

Every `update()` call — from any cascade step — increments `state._version`:

```
FULL cascade (PROFILE_UPDATED):
  before: _version=5
  after simulation: _version=6
  after portfolio:  _version=7
  after risk:       _version=8

PARTIAL cascade (TAX_UPDATED):
  before: _version=8
  after simulation: _version=9
```

The A2UI v2 `version` field on each component equals `state._version` at the time `composeUI()` is called. The Angular client can use this to detect and discard stale responses.
