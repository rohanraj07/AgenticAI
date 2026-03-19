# Agent Reference

This document provides a comprehensive reference for all agents in the AgenticAI financial planning system. Each agent is a discrete node in the LangGraph pipeline, responsible for a specific domain of reasoning. The system is designed around a **TRUST-BY-DESIGN** principle: sensitive user data is abstracted as early as possible and raw values are never propagated downstream.

---

## Architecture Overview

```
User Message
     │
     ▼
PlannerAgent (Orchestrator)
     │
     ├──► ProfileAgent
     ├──► DocumentIngestionAgent ──► (abstracted signals only)
     │                                      │
     ├──► SimulationAgent ◄─────────────────┤
     ├──► PortfolioAgent  ◄─────────────────┤
     ├──► RiskAgent       ◄─────────────────┤
     ├──► TaxAgent        ◄─────────────────┤
     ├──► CashflowAgent   ◄─────────────────┤
     │
     └──► ExplanationAgent (synthesises all)
                │
                ▼
         Structured Response + A2UI Layout
```

---

## 1. PlannerAgent

**LangGraph Node**: `planner`
**File**: `backend/agents/planner.agent.js`

### Purpose

The PlannerAgent is the central orchestrator of the system. It interprets the user's intent, decides which downstream agents to invoke, determines the UI layout to render (Agent-to-UI / A2UI), and routes tax and cashflow queries to their respective specialist agents.

### Input

```json
{
  "message": "Can I retire at 55?",
  "context": "<previous conversation turns>",
  "uploaded_doc": "<optional: document signals if document was ingested>"
}
```

### Output

```json
{
  "intent": "Retirement feasibility check",
  "agents": ["profile", "simulation", "portfolio", "risk", "tax", "explanation"],
  "ui": [
    { "type": "profile_summary" },
    { "type": "simulation_chart" },
    { "type": "portfolio_allocation" },
    { "type": "risk_scorecard" }
  ],
  "routing": {
    "tax": true,
    "cashflow": false
  },
  "params": {}
}
```

### Notes

- Sole entry point into the agent graph; no other agent calls agents directly.
- Responsible for A2UI decisions: maps agent outputs to specific UI component types.
- Tax and cashflow routing is conditional — only activated when the planner detects relevant intent signals.

---

## 2. ProfileAgent

**LangGraph Node**: `profile`
**File**: `backend/agents/profile.agent.js`

### Purpose

Extracts and maintains a structured financial profile for the user by parsing conversation history, Redis memory, and RAG-retrieved context. Produces the canonical user profile object used by all downstream agents.

### Input

- Raw user message
- Redis conversation memory (session context)
- RAG-retrieved financial context

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
  "goals": ["retire_early", "buy_home"],
  "dependents": 2,
  "debt": 15000
}
```

### PII Notes

- Profile data is held in session memory and scoped to the active user session.
- Income and savings figures are used in-flight for computation; they are not logged or persisted to long-term storage beyond the session.

---

## 3. SimulationAgent

**LangGraph Node**: `simulation`
**File**: `backend/agents/simulation.agent.js`

### Purpose

Runs Monte Carlo-style retirement projections based on the user's financial profile, estimating whether the user can meet their retirement goals and surfacing year-by-year savings milestones.

### Input

- User profile (from ProfileAgent)
- Original user message
- RAG-retrieved financial context

### Output

```json
{
  "can_retire_at_target": true,
  "projected_savings_at_retirement": 1200000,
  "monthly_shortfall_or_surplus": 500,
  "years_of_runway": 25,
  "milestones": [
    { "year": 2030, "savings": 400000, "note": "First major milestone" },
    { "year": 2035, "savings": 700000, "note": "Halfway to goal" }
  ],
  "probability_of_success_pct": 82,
  "summary": "Based on your current trajectory..."
}
```

### Notes

- Simulation incorporates inflation assumptions, expected return rates, and variable contribution scenarios.
- If `DocumentIngestionAgent` has run, abstracted income and spending signals supplement the profile inputs.

---

## 4. PortfolioAgent

**LangGraph Node**: `portfolio`
**File**: `backend/agents/portfolio.agent.js`

### Purpose

Recommends a target asset allocation strategy tailored to the user's risk tolerance, time horizon, and retirement goals, and provides rationale for each allocation decision.

### Input

- User profile (from ProfileAgent)
- Simulation results (from SimulationAgent)

### Output

```json
{
  "allocation": [
    { "asset": "Equities", "percent": 60 },
    { "asset": "Bonds", "percent": 25 },
    { "asset": "Real Estate", "percent": 10 },
    { "asset": "Cash / Money Market", "percent": 5 }
  ],
  "strategy": "balanced_growth",
  "expected_annual_return_percent": 7.2,
  "rebalance_frequency": "annually",
  "rationale": "Given a 30-year horizon and medium risk tolerance..."
}
```

---

## 5. RiskAgent

**LangGraph Node**: `risk`
**File**: `backend/agents/risk.agent.js`

### Purpose

Scores the user's overall financial risk exposure and stress-tests the recommended portfolio against adverse market scenarios including market crashes and inflation spikes.

### Input

- User profile (from ProfileAgent)
- Portfolio allocation (from PortfolioAgent)

### Output

```json
{
  "overall_risk_score": 6,
  "risk_level": "medium",
  "factors": [
    {
      "factor": "Market Volatility",
      "impact": "high",
      "description": "Equity-heavy allocation increases short-term drawdown risk."
    },
    {
      "factor": "Inflation Exposure",
      "impact": "medium",
      "description": "Current bond allocation provides partial inflation hedge."
    }
  ],
  "mitigation_steps": [
    "Consider increasing bond allocation by 5%",
    "Introduce inflation-linked securities"
  ],
  "stress_test": {
    "market_crash_20pct_impact": -240000,
    "inflation_spike_3pct_impact": -50000,
    "prolonged_low_return_impact": -180000
  }
}
```

---

## 6. ExplanationAgent

**LangGraph Node**: `explanation`
**File**: `backend/agents/explanation.agent.js`

### Purpose

Synthesises all upstream agent outputs into a single coherent, human-readable narrative that directly answers the user's original question. Serves as the final step before the response is sent to the UI.

### Input

- All upstream agent outputs (profile, simulation, portfolio, risk, tax, cashflow)
- Original user message

### Output

Plain-text narrative paragraph (rendered as the primary chat response), e.g.:

> "Based on your current savings of $200,000 and a monthly contribution of $1,500, you are on track to retire at 65 with an estimated nest egg of $1.2M — giving you approximately 25 years of financial runway. Your balanced portfolio carries a medium risk score of 6/10, and stress testing shows resilience under most market scenarios. To accelerate your timeline, consider increasing monthly contributions by $300 and shifting 5% of equities into bonds as you approach your target date."

### Notes

- Only agent to produce free-form text; all other agents output structured JSON.
- Tone is calibrated to be informative but accessible — no financial jargon without explanation.

---

## 7. DocumentIngestionAgent

**LangGraph Node**: `document_ingestion`
**File**: `backend/agents/documentIngestion.agent.js`

### Purpose

Processes uploaded financial documents (pay stubs, bank statements, tax returns, brokerage summaries) using multi-modal extraction. Implements **TRUST-BY-DESIGN**: raw document text and specific figures are immediately abstracted into generalised signals; the raw values are discarded and never propagated downstream or stored.

### Input

```json
{
  "document_text": "<raw extracted text from uploaded PDF/image>",
  "document_type": "pay_stub | bank_statement | tax_return | brokerage_summary"
}
```

### Output — Abstracted Signals Only

```json
{
  "income_range": "75k–100k",
  "tax_bracket": "22%",
  "spending_level": "moderate",
  "savings_rate_band": "15–20%",
  "debt_load": "low",
  "investment_activity": "passive_index",
  "employment_type": "salaried",
  "signals_confidence": 0.87
}
```

### Trust / PII Design

| Principle | Implementation |
|---|---|
| **No raw values downstream** | Exact figures (salary amount, account balances) are converted to range/band labels before leaving this agent. |
| **Immediate discard** | Raw document text is not stored in memory, cache, or logs after extraction completes. |
| **No PII propagation** | Downstream agents (TaxAgent, CashflowAgent, SimulationAgent) receive only abstracted signal labels — never account numbers, names, or exact monetary values. |
| **Confidence scoring** | Each signal set carries a `signals_confidence` score; low-confidence extractions are flagged for user clarification rather than assumed. |

### Supported Document Types

- Pay stubs / payslips
- Bank and credit card statements
- Federal and state tax returns (W-2, 1040)
- Brokerage and retirement account summaries (401k, IRA)

---

## 8. TaxAgent

**LangGraph Node**: `tax`
**File**: `backend/agents/tax.agent.js`

### Purpose

Analyzes tax efficiency and produces actionable tax optimization strategies based exclusively on abstracted signals from DocumentIngestionAgent or profile-derived tax context. Provides retirement-phase tax impact analysis and account type recommendations.

### Input

```json
{
  "tax_bracket": "22%",
  "income_range": "75k–100k",
  "investment_activity": "passive_index",
  "retirement_age": 65,
  "profile_context": { "age": 35, "risk_tolerance": "medium" }
}
```

### Output

```json
{
  "current_tax_efficiency_score": 72,
  "estimated_tax_drag_band": "moderate",
  "optimization_strategies": [
    {
      "strategy": "Maximize 401(k) pre-tax contributions",
      "estimated_annual_benefit": "Reduces taxable income by one bracket band",
      "priority": "high"
    },
    {
      "strategy": "Roth IRA conversion ladder",
      "estimated_annual_benefit": "Tax-free growth post-retirement",
      "priority": "medium"
    },
    {
      "strategy": "Tax-loss harvesting in taxable accounts",
      "estimated_annual_benefit": "Offsets capital gains",
      "priority": "low"
    }
  ],
  "retirement_tax_impact": {
    "rmd_exposure": "moderate",
    "roth_vs_traditional_recommendation": "Roth favored given current bracket",
    "social_security_taxation_risk": "low"
  },
  "disclaimer": "This analysis is for informational purposes only and does not constitute tax advice. Consult a qualified tax professional before making tax-related financial decisions."
}
```

### Trust / PII Notes

- Receives only abstracted signal labels from DocumentIngestionAgent — never raw income figures, SSNs, or account details.
- All strategy recommendations are generalised to bracket bands and range labels, not specific dollar amounts.
- Disclaimer is always included in output and rendered in the UI.

---

## 9. CashflowAgent

**LangGraph Node**: `cashflow`
**File**: `backend/agents/cashflow.agent.js`

### Purpose

Analyzes spending patterns and cash flow health from abstracted signals, identifies opportunities for savings acceleration, and provides prioritised recommendations to improve the user's financial trajectory toward retirement goals.

### Input

```json
{
  "spending_level": "moderate",
  "savings_rate_band": "15–20%",
  "debt_load": "low",
  "income_range": "75k–100k",
  "profile_context": {
    "age": 35,
    "monthly_expenses": 3500,
    "retirement_age": 65
  }
}
```

### Output

```json
{
  "cashflow_health_score": 68,
  "cashflow_status": "stable_with_room_to_improve",
  "spending_pattern": "moderate_discretionary",
  "savings_acceleration_potential": {
    "band": "medium",
    "estimated_monthly_increase_range": "$200–$500",
    "impact_on_retirement_timeline": "Could accelerate retirement by 1–3 years"
  },
  "recommendations": [
    {
      "category": "Emergency Fund",
      "recommendation": "Current savings rate supports a 6-month emergency fund target",
      "priority": "high"
    },
    {
      "category": "Debt Management",
      "recommendation": "Low debt load — redirect freed cash flow to retirement contributions",
      "priority": "medium"
    },
    {
      "category": "Discretionary Spending",
      "recommendation": "Moderate spending level suggests room to increase savings rate by 3–5%",
      "priority": "medium"
    }
  ],
  "savings_rate_benchmark": {
    "current_band": "15–20%",
    "recommended_band": "20–25%",
    "gap": "moderate"
  }
}
```

### Trust / PII Notes

- Operates exclusively on abstracted spending signals — never raw transaction data, account numbers, or exact balance figures.
- Recommendations are expressed as ranges and relative labels (e.g., "moderate", "$200–$500") to avoid false precision from abstracted inputs.

---

## Agent Invocation Matrix

| User Intent | Agents Invoked |
|---|---|
| "Can I retire at 55?" | Profile, Simulation, Portfolio, Risk, Explanation |
| "Review my pay stub" | DocumentIngestion, Profile, Simulation, Tax, Cashflow, Explanation |
| "How tax-efficient is my portfolio?" | Profile, Tax, Explanation |
| "Am I spending too much?" | Profile, Cashflow, Explanation |
| "What's my risk exposure?" | Profile, Portfolio, Risk, Explanation |
| "Full financial health check" | All agents |

---

## Design Principles

### TRUST-BY-DESIGN

The pipeline is architected so that sensitive financial data is abstracted at the earliest possible point (DocumentIngestionAgent) and only signal labels flow to all subsequent agents. This means:

- No raw PII travels through the LangGraph state object between nodes.
- Agent prompts never see exact salaries, account balances, or tax figures — only banded/labelled abstractions.
- Logs and traces contain no sensitive financial values.

### Separation of Concerns

Each agent owns a single domain. The PlannerAgent is the only node with cross-agent awareness; all other agents are stateless with respect to each other and communicate only through the shared LangGraph state object.

### Disclaimer Propagation

Any output from TaxAgent is always accompanied by a regulatory disclaimer. The ExplanationAgent is responsible for surfacing this disclaimer in the final user-facing response whenever tax-related content is included.
