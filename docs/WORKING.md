# WORKING — How to Verify Everything is Running

---

## Quick Start

```bash
# Terminal 1 — Backend
cd backend && npm install && npm run dev

# Terminal 2 — Frontend
cd frontend && npm install && npm start
```

Open: http://localhost:4200

---

## What to expect in the logs

The backend now logs each phase of the hybrid pipeline. Here is the full log flow for a typical run.

### Step 1 — Base Chat: "Can I retire at 55?"

```
[Route]    POST /chat | session: <uuid>
[Route]    session loaded | profile: false | docInsights: [none]
[ReactiveEngine] seeded session=<uuid> from Redis

[LangGraph] ▶ node_planner START | message: "Can I retire at 55?"
[LangGraph] ✔ node_planner DONE (1200ms) | intent: "Retirement feasibility check" | agents: [profile, simulation, explanation]
[LangGraph]   confidence: high

[LangGraph] ▶ node_profile START
[LangGraph] ✔ node_profile DONE (900ms) | name=User age=35 risk=medium

[LangGraph] ▶ node_simulation START | age=35, savings=$200000, retire_at=65
[Agent]    SimulationAgent [1/2] deterministic projection
[Agent]      Years to retirement: 30
[Agent]      Monthly savings: $2,833/mo
[Agent]      Annual contributions: $34,000/yr
[Agent]      Projected savings: $4,347,122
[Agent]      Required savings (25x rule): $1,050,000
[Agent]      Can retire at target: true
[Agent]      Monthly surplus: $10,990
[Agent]    SimulationAgent [2/2] LLM narrative generation
[LangGraph] ✔ node_simulation DONE (5200ms) | can_retire=true | projected=$4,347,122

[LangGraph] ▶ node_explanation START
[LangGraph] ✔ node_explanation DONE (2100ms) | 342 chars

[Route]    → profile saved
[Route]    → simulation saved | can_retire=true
[ReactiveEngine] PROFILE_UPDATED → cascade=[simulation, portfolio, risk] session=<uuid>
[ReactiveEngine] ✔ simulation recomputed (2ms)
[ReactiveEngine] skip portfolio — prerequisite state missing
[ReactiveEngine] skip risk — prerequisite state missing
```

Expected UI panels: `profile_summary`, `simulation_chart`, `explanation_panel`

---

### Step 2 — Portfolio + Risk: "What should I invest in?"

```
[LangGraph] ✔ node_planner DONE | agents: [simulation, portfolio, risk, explanation]

[LangGraph] ▶ node_simulation START | age=35, savings=$200000, retire_at=65
[Agent]    SimulationAgent [1/2] deterministic projection
[Agent]      Projected savings: $4,347,122
[Agent]    SimulationAgent [2/2] LLM narrative generation
[LangGraph] ✔ node_simulation DONE (4800ms)

[LangGraph] ▶ node_portfolio START | risk_tolerance=medium
[Agent]    PortfolioAgent [1/2] deterministic allocation
[Agent]      Strategy:  balanced
[Agent]      Equities:  60% | Glide: accumulation
[Agent]      Return:    6.6% expected
[Agent]      Rebalance: annually
[Agent]    PortfolioAgent [2/2] LLM rationale generation
[LangGraph] ✔ node_portfolio DONE (3100ms) | strategy=balanced | return=6.6%
[LangGraph]   allocation: [Equities:60%, Bonds:30%, Real Estate:5%, Cash:5%]

[LangGraph] ▶ node_risk START | strategy=balanced
[Agent]    RiskAgent [1/2] deterministic scoring
[Agent]      Score: 3/10 | Level: low
[Agent]      Factors → equity: 2/3 | time: 0/3 | gap: 0/3
[Agent]      Stress test → crash: $521,655 | inflation: $217,356
[Agent]    RiskAgent [2/2] LLM risk narrative generation
[LangGraph] ✔ node_risk DONE (2900ms) | score=3/10 | level=low

[ReactiveEngine] SIMULATION_UPDATED → cascade=[portfolio, risk]
[ReactiveEngine] ✔ portfolio recomputed (1ms)
[ReactiveEngine] ✔ risk recomputed (1ms)
```

Expected UI panels: `simulation_chart`, `portfolio_view`, `risk_dashboard`, `explanation_panel`

---

### Step 3 — Upload Tax Document

Use sample: `backend/data/sample-tax-document.txt`

```
[Route]    POST /upload | session: <uuid> | file: "sample-tax-document.txt" (3142 bytes)
[Route]    ⚠️  TRUST-BY-DESIGN: File received in-memory. Will NOT be written to disk.
[Agent]    DocumentIngestionAgent: processing "sample-tax-document.txt" (3142 chars)
[Agent]    ⚠️  Raw document text will NOT be stored
[Agent]    Classification: tax_document (confidence: high)
[Agent]    Sanitizing raw_values → abstractions (raw values discarded after)...
[Agent]    taxInsights: income_range=UPPER_MIDDLE, bracket=22%, deductions=MODERATE
[Agent]    ✅ Raw values discarded — only abstracted signals returned

[LangGraph] ▶ node_planner SKIP — plan pre-seeded
[LangGraph] ▶ node_profile START
[LangGraph] ✔ node_profile DONE (880ms)

[LangGraph] ▶ node_tax START | bracket: 22%, income: UPPER_MIDDLE
[Agent]    TaxAgent [1/4] parseTaxSignals
[Agent]    TaxAgent [2/4] analyzeDeductions | score=2/4 | gap=true
[Agent]    TaxAgent [3/4] LLM chain
[Agent]    TaxAgent [4/4] rankOptimizationStrategies
[LangGraph] ✔ node_tax DONE (3100ms) | efficiency=6/10 | strategies=4

[LangGraph] ▶ node_simulation START
[Agent]    SimulationAgent [1/2] deterministic projection
[Agent]      Projected savings: $4,347,122
[LangGraph] ✔ node_simulation DONE (4200ms)

[Route]    → profile saved
[Route]    → simulation saved
[Route]    → tax saved | efficiency=6/10
[ReactiveEngine] TAX_UPDATED → cascade=[simulation] session=<uuid>
[ReactiveEngine] ✔ simulation recomputed (3ms)
```

Expected UI panels: `profile_summary`, `tax_panel`, `simulation_chart`, `explanation_panel`

**Key demo point:** Open `backend/data/sessions/<sessionId>.md`:
```markdown
## Tax Intelligence (Abstracted Signals)
> 🔒 Raw tax document NOT stored. Only derived signals below.
- Income Range: UPPER_MIDDLE
- Tax Bracket: 22%
- Effective Rate: 18.5%
- Deductions Level: MODERATE
```
No SSN. No exact income. No account numbers. Only abstracted signals.

---

### Step 4 — Upload Bank Statement

Use sample: `backend/data/sample-bank-statement.txt`

```
[Agent]    Classification: bank_statement (confidence: high)
[Agent]    cashflowInsights: income_range=MIDDLE, spending=ELEVATED, savings=GOOD

[LangGraph] ▶ node_cashflow START | spending=ELEVATED savings_rate=GOOD
[Agent]    CashflowAgent [1/4] parseCashflowSignals
[Agent]    CashflowAgent [2/4] classifySpendingRisk | risk=medium requires_intervention=false
[Agent]    CashflowAgent [3/4] LLM chain
[Agent]    CashflowAgent [4/4] deriveSavingsInsight | score=3/5 potential=MODERATE
[LangGraph] ✔ node_cashflow DONE (2800ms) | budget=good | recs=3

[ReactiveEngine] CASHFLOW_UPDATED → cascade=[simulation]
[ReactiveEngine] ✔ simulation recomputed (2ms)
```

Expected UI panels: `profile_summary`, `cashflow_panel`, `simulation_chart`, `explanation_panel`

---

### Step 5 — Follow-up Chat: "What should I improve to retire earlier?"

System now has: profile + tax insights + cashflow signals + simulation

```
[Route]    session loaded | profile: true | docInsights: [tax, cashflow]
[ReactiveEngine] seeded session=<uuid> from Redis
[LangGraph] ✔ node_planner DONE | agents: [cashflow, simulation, explanation]
[LangGraph] ✔ node_cashflow DONE — re-runs with persisted cashflowInsights
```

Planner enriches response using all accumulated context. No re-upload needed.

---

### Step 6 — Enforcement Features (v3 logs)

#### SchemaValidator — clean write

```
[Info] [SchemaValidator] ✔ session write validated — keys=[profile, simulation, uiContext]
```

#### SchemaValidator — blocked write (what a bug would look like)

```
[Error] [SchemaValidator] BLOCKED Redis write — PII violations detected:
  • Forbidden raw PII field "documentInsights.tax.grossIncome" detected.
    Use an abstracted label (e.g. income_range, budget_health) instead.
  • Missing required abstracted field "documentInsights.tax.income_range".
    Raw document values must be abstracted before storage.
```

If you see this in logs: the PII sanitizer has a bug — it produced raw values instead of labels.

#### StaleGuard — higher-priority event aborts cascade mid-run

```
[ReactiveEngine] cascade aborted at risk (superseded by higher-priority event) session=<uuid>
[ReactiveEngine] PROFILE_UPDATED → FULL cascade | agents=[simulation, portfolio, risk] session=<uuid>
[ReactiveEngine] ✔ simulation recomputed (2ms)
[ReactiveEngine] ✔ portfolio recomputed (1ms)
[ReactiveEngine] ✔ risk recomputed (1ms)
```

Notice `cascade aborted at risk` — the old cascade exited before completing. The new FULL cascade then ran cleanly.

#### VectorStore — session-scoped queries

```
[VectorDB] queryForSession session=<uuid> query="retirement feasibility..."
[VectorDB] SEARCH query: retirement feasibility... | session: <uuid>
[VectorDB]   → ChromaDB returned 3 results
```

If `queryForSession` were called without a sessionId, you'd see an error thrown immediately (not logged — it crashes the caller).

#### Optimistic lock — version tracking

```
[Redis] SET session:<uuid> (TTL 3600s, 1240 bytes)
[Redis] updateSession <uuid> → merged keys: [profile] version=3
[Redis] updateSession <uuid> → merged keys: [simulation] version=4
[Redis] updateSession <uuid> → merged keys: [portfolio] version=5
```

Version increments on every write. If you see the same version twice, there's a write that didn't go through `updateSession()`.

---

## Verifying Deterministic Compute

To confirm numbers come from math, not LLM:

```bash
# Check simulation inputs and outputs in the log
grep "SimulationAgent \[1/2\]" backend/logs/  # or watch stdout

# You should see:
# Monthly savings: $2,833/mo   ← (80000/12) - 3500 = 3167 ← verify with calculator
# Annual contributions: $34,000/yr
# Projected savings: $4,347,122  ← FV formula, not LLM estimate
```

The numbers in the log are always the same for the same profile. The LLM only changes the *text* around them.

---

## Verifying Reactive Cascade

To confirm ReactiveEngine fires on profile change:

```bash
# Watch for ReactiveEngine log lines
grep "ReactiveEngine" backend/logs/

# After first message you should see:
# [ReactiveEngine] seeded session=<uuid> from Redis
# [ReactiveEngine] PROFILE_UPDATED → cascade=[simulation, portfolio, risk]
# [ReactiveEngine] ✔ simulation recomputed (2ms)
```

Notice the ReactiveEngine recomputes in ~2ms (pure math) vs 4800ms for the full LLM simulation node.

---

## Verifying PII Safety

### What should NOT appear anywhere:

```bash
# Check Redis
redis-cli GET "session:<uuid>" | python3 -m json.tool | grep -E "148500|SSN|account"
# → should return nothing

# Check Markdown memory file
cat backend/data/sessions/<uuid>.md | grep -E "148500|SSN"
# → should return nothing
```

### What SHOULD appear:

```bash
# Redis should contain abstracted signals
redis-cli GET "session:<uuid>" | python3 -m json.tool | grep income_range
# → "income_range": "UPPER_MIDDLE"

# Markdown file should show abstracted labels
cat backend/data/sessions/<uuid>.md
# → Income Range: UPPER_MIDDLE
# → Tax Bracket: 22%
# → Spending Level: ELEVATED
```

---

## Log Color Reference

| Color | Prefix | Meaning |
|-------|--------|---------|
| Cyan | `[Route]` | HTTP request handling |
| Magenta | `[Agent]` | Agent execution |
| Yellow | `[LangGraph]` | Graph node execution |
| Blue | `[VectorDB]` | ChromaDB operations |
| Cyan | `[Redis]` | Redis operations |
| White | `[ReactiveEngine]` | Reactive cascade execution |
| Gray | `[Warn]` | Degraded mode / fallback |
| Red | `[Error]` | Error with stack trace |

---

## Service Status

| Color | Meaning |
|-------|---------|
| 🟢 Green | Service running and connected |
| 🟡 Yellow | Fallback mode active (in-memory) |
| 🔴 Red | Unavailable |

Fallback mode: system fully functional — Redis → in-memory Map, ChromaDB → keyword search.

---

## What Each Layer Stores After a Full Session

**Redis key** `session:<sessionId>`:
```json
{
  "profile":    { "age": 38, "income": 85000, "risk_tolerance": "medium", ... },
  "simulation": { "can_retire_at_target": true, "projected_savings_at_retirement": 4347122, ... },
  "portfolio":  { "allocation": [...], "strategy": "balanced", "expected_annual_return_percent": 6.6 },
  "risk":       { "overall_risk_score": 3, "risk_level": "low", "stress_test": {...} },
  "tax":        { "tax_efficiency_score": 6, "tax_bracket": "22%", ... },
  "cashflow":   { "budget_health": "good", "savings_rate_label": "GOOD", ... },
  "documentInsights": {
    "tax":      { "income_range": "UPPER_MIDDLE", "tax_bracket": "22%", ... },
    "cashflow": { "spending_level": "ELEVATED", "savings_rate": "GOOD", ... }
  }
}
```

**Markdown file** `backend/data/sessions/<uuid>.md`:
- Abstracted profile + simulation summary + tax + cashflow signals
- PII policy header at top
- Injected as LLM context on every subsequent request

**ChromaDB / fallback**:
- Anonymized insight summaries (no raw values)
- Semantic RAG retrieval enriches future responses

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module 'multer'` | `cd backend && npm install` |
| `savings_gap is not defined` (startup error) | Template literal bug — use `{savings_gap}` not `${savings_gap}` in prompts.js |
| LLM not responding | Check `GROQ_API_KEY` / `OPENAI_API_KEY` in `.env`, or run `ollama serve` |
| Upload returns 400 | File must be `.txt`, `.json`, or `.csv`; field name must be `document` |
| Angular compile error | `cd frontend && npm install` |
| Port 3000 in use | `lsof -ti:3000 \| xargs kill` |
| Simulation number seems wrong | Check that `financial.calculator.js` is being used — confirm log shows `[Agent] SimulationAgent [1/2] deterministic projection` |
| `SchemaViolationError` thrown | PII sanitizer bug — raw field (grossIncome, accountNumber, etc.) reached updateSession(). Fix the sanitizer, not the validator. |
| `OptimisticLockError` thrown | Two writes hit the same session concurrently with `_expectedVersion` set. Caller should retry with a fresh `getSession()`. |
| `queryForSession: sessionId is required` | Agent or route called VectorStore without passing sessionId. Always use `queryForSession(sessionId, query)`. |
| Cascade log shows "aborted at …" | Expected — StaleGuard cancelled a lower-priority cascade when a higher-priority event arrived. No action needed. |
