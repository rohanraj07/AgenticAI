# How It Works — AI Financial Planner POC

> **Positioning:** "A privacy-aware, intelligent financial advisor that evolves with user inputs while minimizing exposure of sensitive data."

---

## Business Context

Traditional financial planning tools are:
- **Static**: You fill a form, get a fixed report
- **Risky**: They store raw documents (tax returns, bank statements) creating PII liability
- **Opaque**: You don't know which rules drove the recommendations

This system is different:
- **Conversational**: Chat-first, natural language in/out
- **Adaptive**: UI evolves as more data arrives (A2UI)
- **Multi-agent**: Specialized AI agents reason in parallel (A2A)  
- **Trustworthy**: Raw documents are never stored — only abstracted insights

---

## The Three Core Patterns

### 1. A2UI — Agent-to-UI Dynamic Rendering

**The AI composes the layout. The frontend never decides what to show.**

```
User: "I just uploaded my tax return"
         │
   PlannerAgent decides:
   plan.ui = [
     { type: "tax_panel" },
     { type: "simulation_chart" },
     { type: "explanation_panel" }
   ]
         │
   Angular DynamicRendererComponent maps types → components
   → Tax Intelligence panel renders
   → Updated simulation renders
   → Explanation renders
```

The server tells the frontend which components to show. The frontend is a pure rendering layer. This means:
- New panels can be added server-side without frontend deploys
- The AI can compose novel layouts based on context
- Different users see different UI depending on their data

**Supported UI types today:**
`profile_summary` | `simulation_chart` | `portfolio_view` | `risk_dashboard` | `tax_panel` | `cashflow_panel` | `explanation_panel`

---

### 2. A2A — Agent-to-Agent Communication via LangGraph

Agents share a state graph. Each agent reads upstream results and writes its own channel:

```
LangGraph State Object:
{
  message:          "Can I retire at 55?",
  plan:             { agents: [...], ui: [...] },    ← planner writes
  profile:          { age: 38, risk: "medium" },     ← profile agent writes
  taxInsights:      { income_range: "HIGH", ... },   ← pre-seeded from upload
  tax:              { efficiency: 7, strategies: [] },← tax agent writes
  simulation:       { can_retire: false, ... },       ← simulation agent writes
  explanation:      "Based on your profile..."        ← explanation agent writes
  trace:            [{ agent: "planner", latencyMs: 1200 }, ...]
}
```

The planner decides routing. If taxInsights are in state, it routes through `node_tax`. Each agent enriches the state for the next one.

---

### 3. Trust-by-Design — Privacy-Preserving Reasoning

**"Agents never operate on raw PII."**

#### The Upload Flow (Key Demo Moment)

```
User uploads: sample-tax-document.txt (contains "$148,500", "SSN: XXX-XX-1234")
                        │
                        ▼
              Multer: memoryStorage
              (file NEVER touches disk)
                        │
                        ▼
         DocumentIngestionAgent receives text buffer
                        │
                   LLM reads raw text
                   extracts raw_values temporarily:
                   { grossIncome: 148500, effectiveTaxRate: 10.55 }
                        │
                   PII Sanitizer converts:
                   grossIncome: 148500 → income_range: "HIGH"
                   effectiveTaxRate: 10.55% → effective_rate: "10.6%"
                   rawValues DISCARDED ← this is the key step
                        │
                        ▼
              taxInsights = {
                income_range:     "HIGH",      ← not "$148,500"
                tax_bracket:      "32%",        ← marginal bracket
                deductions_level: "MODERATE",   ← not "$32,600"
                effective_rate:   "10.6%"
              }
                        │
                        ▼
              TaxAgent receives taxInsights (abstractions only)
              Redis stores taxInsights (abstractions only)
              Markdown stores taxInsights (abstractions only)
              ChromaDB stores insight summary (no raw values)
```

**What gets stored in `backend/data/sessions/<id>.md`:**
```markdown
## Tax Intelligence (Abstracted Signals)
> 🔒 Raw tax document NOT stored. Only derived signals below.
- Income Range: HIGH
- Tax Bracket: 32%
- Effective Rate: 10.6%
- Deductions Level: MODERATE
```

No SSN. No exact dollar amounts. No account numbers.

#### Tiered Memory Safety

| Layer | Stores | Never Stores |
|-------|--------|-------------|
| Redis | Sanitized profile, abstracted tax/cashflow signals | Raw documents, SSNs, exact amounts |
| Markdown | Redacted summaries, range labels | PII, transaction data |
| ChromaDB | Anonymized insight strings | Raw document embeddings |
| Disk | Nothing from uploaded files | Raw uploaded files |

---

## Agent Roles (Business Context)

### PlannerAgent
**Why needed:** Without a planner, you'd need hardcoded if/else rules for every user scenario. The planner uses LLM reasoning to interpret intent and compose responses dynamically.

### ProfileAgent
**Why needed:** Users describe their situation in natural language. The profile agent extracts structured data (age, income, savings, risk tolerance) so downstream agents can reason numerically.

### SimulationAgent
**Why needed:** Core value of a financial planner — "Can I retire at 55?" needs math. The simulation projects savings growth over time, identifies gaps, and sets milestones.

### PortfolioAgent
**Why needed:** Asset allocation directly impacts whether someone reaches retirement goals. The portfolio agent recommends allocations based on risk tolerance and timeline.

### RiskAgent
**Why needed:** Every plan has downside scenarios. The risk agent stress-tests the portfolio (market crash, inflation spike) and quantifies exposure. This builds user trust.

### DocumentIngestionAgent ← NEW
**Why needed:** Users have real financial documents. Rather than ignoring them or storing them dangerously, this agent extracts only the signals needed for reasoning — making the system multi-modal AND privacy-preserving.

### TaxAgent ← NEW
**Why needed:** Tax optimization is often the highest-leverage financial planning tool. Many people in the 22-32% bracket have untapped opportunities (401k, HSA, Roth conversions). This agent provides personalized tax strategy based on abstracted signals.

### CashflowAgent ← NEW
**Why needed:** Retirement projections are only as good as your savings rate. If someone spends 85% of income, simulation says "shortfall" but doesn't explain why. Cashflow analysis surfaces the behavioral levers.

### ExplanationAgent
**Why needed:** LLM outputs from other agents are JSON. Users need plain English. The explanation agent synthesizes all agent outputs into a human-readable narrative that directly answers the user's question.

---

## Reactive Event Flow

When a request comes in, the backend emits WebSocket events as agents complete:

```
POST /api/chat
  → EventEmitter.emitAgentStarted('planner')   → WS: { type: "AGENT_STARTED", agent: "planner" }
  → node_planner runs
  → node_profile runs
  → EventEmitter.emitProfileUpdated(profile)   → WS: { type: "PROFILE_UPDATED", data: profile }
  → node_simulation runs
  → EventEmitter.emitSimulationUpdated(sim)    → WS: { type: "SIMULATION_UPDATED", data: sim }
  → HTTP response returned with full result
```

Angular's WebSocketService subscribes and can surface intermediate updates in real time.

---

## Work Laptop Setup

Minimum requirements — no Docker needed:

1. Set `OPENAI_API_KEY` in `backend/.env`
2. `cd backend && npm install && npm start`
3. `cd frontend && npm install && npm start`

Redis → in-memory Map fallback (session data works, just not persisted across restarts)  
ChromaDB → keyword search fallback (RAG works, just not semantic)  
Ollama → not needed (OpenAI used instead)

**To switch back to Ollama**: comment out `OPENAI_API_KEY`, uncomment `OLLAMA_*` lines.

---

## Session Markdown Files

Every conversation turn generates a `.md` file at `backend/data/sessions/<sessionId>.md`.

**Dual purpose:**
1. **LLM context injection**: On the next turn, this file is read and injected into agent prompts so the LLM has conversational memory even across restarts.
2. **RAG source**: The file (or a summary of it) is embedded in ChromaDB, enabling semantic retrieval across sessions.

**PII audit trail**: These files intentionally contain NO sensitive data — they're the audit record that proves the system's privacy claims.

---

## What the LLM Actually Reasons About

The LLM never sees your raw tax return. It sees:

```
Tax signals (abstracted):
{
  "income_range": "HIGH",
  "tax_bracket": "32%",
  "effective_rate": "10.6%",
  "deductions_level": "MODERATE",
  "filing_status": "married_filing_jointly"
}
```

This is enough to reason about: "Should this person contribute to a Roth IRA vs traditional 401k? Are they maximizing HSA? Is there capital gains harvesting opportunity?"

The LLM operates on **financial signals**, not **personal identity**.
