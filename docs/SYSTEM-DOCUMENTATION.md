# AI Financial Planner — System Documentation

> **Audience**: Engineers, architects, and operators who need to understand, debug, extend, or operate the system.
> **Version**: Post-refactor (multi-agent, trust-by-design, LangGraph orchestration)

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

### Core Design Principles

1. **Trust-by-Design** — Exact income, account numbers, and SSNs are processed in-memory and immediately discarded. Only derived signals (e.g. `income_range: "UPPER_MIDDLE"`) are stored.
2. **Orchestrated Agency** — LangGraph controls execution order deterministically. LLMs only decide *what* to run (planner) and *what to say* (each agent's output).
3. **Graceful Degradation** — Redis falls back to in-memory, ChromaDB falls back to in-memory, every graph node has try/catch so one failing agent cannot crash the pipeline.

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
│  AGENT LAYER                                                      │
│  PlannerAgent    ProfileAgent     SimulationAgent                │
│  TaxAgent        CashflowAgent    PortfolioAgent                 │
│  RiskAgent       ExplanationAgent DocumentIngestionAgent         │
│                                                                   │
│  Each agent: PromptTemplate → LLM (Ollama/OpenAI) → Parser      │
│  Tax + Cashflow have internal pure-function sub-agent pipelines  │
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
| **Responsibility** | Run financial projection to retirement |
| **Trigger** | Plan includes `"simulation"` |
| **Inputs** | `profile`, `message`, `ragContext`, `currentYear` |
| **Output** | `{ can_retire_at_target, projected_savings_at_retirement, monthly_shortfall_or_surplus, years_of_runway, milestones[3], summary }` |
| **Dependencies** | Runs after profile (uses profile data; falls back to `DEFAULT_PROFILE` if null) |

**Note**: Exactly 3 milestones are generated at roughly equal intervals to prevent LLM over-generation.

---

### portfolio_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/portfolio.agent.js` |
| **Responsibility** | Recommend investment allocation based on risk tolerance and simulation |
| **Trigger** | Plan includes `"portfolio"` |
| **Inputs** | `profile`, `simulation` |
| **Output** | `{ allocation[], strategy, expected_annual_return_percent, rebalance_frequency, rationale }` |
| **Dependencies** | Requires simulation results |

---

### risk_agent

| Field | Value |
|---|---|
| **File** | `backend/agents/risk.agent.js` |
| **Responsibility** | Score financial risk and provide mitigation steps |
| **Trigger** | Plan includes `"risk"` |
| **Inputs** | `profile`, `portfolio` |
| **Output** | `{ overall_risk_score, risk_level, factors[], mitigation_steps[], stress_test{} }` |
| **Dependencies** | Requires portfolio results |

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

> **Note**: The HTTP response is still the primary data source for UI rendering. WebSocket events are currently wired for loading indicators. Connecting them to the `DynamicRendererComponent` for progressive rendering is the next architectural enhancement.
