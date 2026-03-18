# Agent Reference

## 1. PlannerAgent (Orchestrator)

**File**: `backend/agents/planner.agent.js`

**Responsibility**: Interprets user intent and decides:
- Which downstream agents to invoke
- Which UI components to render

**Input**:
```json
{ "message": "Can I retire at 55?", "context": "previous conversation..." }
```

**Output**:
```json
{
  "intent": "Retirement feasibility check",
  "agents": ["profile", "simulation", "portfolio", "explanation"],
  "ui": [{"type": "profile_summary"}, {"type": "simulation_chart"}],
  "params": {}
}
```

---

## 2. ProfileAgent

**File**: `backend/agents/profile.agent.js`

**Responsibility**: Extracts and maintains a structured user financial profile from conversation.

**Input**: raw message + Redis memory + RAG context

**Output**:
```json
{
  "name": "...", "age": 35, "income": 80000, "savings": 200000,
  "monthly_expenses": 3500, "retirement_age": 65,
  "risk_tolerance": "medium", "goals": []
}
```

---

## 3. SimulationAgent

**File**: `backend/agents/simulation.agent.js`

**Responsibility**: Projects savings trajectory and retirement feasibility.

**Input**: profile + message + RAG context

**Output**:
```json
{
  "can_retire_at_target": true,
  "projected_savings_at_retirement": 1200000,
  "monthly_shortfall_or_surplus": 500,
  "years_of_runway": 25,
  "milestones": [{"year": 2030, "savings": 400000, "note": "..."}],
  "summary": "..."
}
```

---

## 4. PortfolioAgent

**File**: `backend/agents/portfolio.agent.js`

**Responsibility**: Recommends investment allocation.

**Input**: profile + simulation results

**Output**:
```json
{
  "allocation": [{"asset": "Equities", "percent": 60}],
  "strategy": "balanced",
  "expected_annual_return_percent": 7,
  "rebalance_frequency": "annually",
  "rationale": "..."
}
```

---

## 5. RiskAgent

**File**: `backend/agents/risk.agent.js`

**Responsibility**: Scores financial risk and stress-tests the portfolio.

**Input**: profile + portfolio

**Output**:
```json
{
  "overall_risk_score": 6,
  "risk_level": "medium",
  "factors": [{"factor": "Market Volatility", "impact": "high", "description": "..."}],
  "mitigation_steps": ["Increase bond allocation"],
  "stress_test": {"market_crash_20pct_impact": -240000, "inflation_spike_impact": -50000}
}
```

---

## 6. ExplanationAgent

**File**: `backend/agents/explanation.agent.js`

**Responsibility**: Synthesises all agent outputs into a human-readable narrative.

**Input**: all outputs + original user message

**Output**: Plain text paragraph answering the user's question.
