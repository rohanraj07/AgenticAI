# WORKING — How to Verify Everything is Running

## Quick Start

```bash
# Terminal 1 — Backend
cd backend && npm install && npm start

# Terminal 2 — Frontend
cd frontend && npm start
```

Open: http://localhost:4200

---

## Demo Script (End-to-End)

### Step 1 — Base Chat
Ask: **"Can I retire at 55?"**

Expected backend logs:
```
[Route]    POST /chat | session: <uuid>
[LangGraph] ▶ node_planner START
[LangGraph] ✔ node_planner DONE (1200ms) | intent: "Assess early retirement..." | agents: [profile, simulation, explanation]
[LangGraph] ▶ node_profile START
[LangGraph] ✔ node_profile DONE (900ms) | name: User, age: 35, income: $80000
[LangGraph] ▶ node_simulation START
[LangGraph] ✔ node_simulation DONE (1100ms) | can_retire=false | projected=$320000 | runway=12yrs
[LangGraph] ▶ node_explanation START
[LangGraph] ✔ node_explanation DONE (800ms)
```

Expected UI panels: `profile_summary`, `simulation_chart`, `explanation_panel`

---

### Step 2 — Upload Tax Document
Use sample: `backend/data/sample-tax-document.txt`

Expected backend logs:
```
[Route]    POST /upload | session: <uuid> | file: "sample-tax-document.txt" (3142 bytes)
[Route]    ⚠️  TRUST-BY-DESIGN: File received in-memory. Will NOT be written to disk.
[Agent]    DocumentIngestionAgent: processing "sample-tax-document.txt" (3142 chars of raw text)
[Agent]    ⚠️  Raw document text will NOT be stored — extracting abstractions only
[Agent]    Classification: tax_document (confidence: high)
[Agent]    Primary insight: "Married couple in upper-middle income bracket with 32% marginal rate"
[Agent]    Sanitizing raw values → abstractions (raw values will be discarded)...
[Agent]    Tax abstractions: income_range=HIGH, bracket=32%, deductions=MODERATE
[Agent]    ✅ Raw values discarded — only abstracted signals returned
[LangGraph] ▶ node_tax START | bracket: 32%, income: HIGH
[LangGraph] ✔ node_tax DONE (1300ms) | efficiency: 7/10 | strategies: 4
```

Expected UI panels: `tax_panel`, `simulation_chart`, `explanation_panel`

**Key demo point:** Open `backend/data/sessions/<sessionId>.md` — you'll see:
```markdown
## Tax Intelligence (Abstracted Signals)
> 🔒 Raw tax document NOT stored. Only derived signals below.
- **Income Range**: HIGH
- **Tax Bracket**: 32%
- **Effective Rate**: 10.6%
- **Deductions Level**: MODERATE
```
No SSN, no exact amounts — only abstracted signals.

---

### Step 3 — Upload Bank Statement
Use sample: `backend/data/sample-bank-statement.txt`

Expected logs:
```
[Agent]    CashflowAgent: analyzing spending patterns from abstracted signals
[Agent]    Signals: income=HIGH, spending=MODERATE, savings=GOOD
[LangGraph] ✔ node_cashflow DONE | budget: good | recommendations: 3
```

Expected UI panels: `cashflow_panel`, `explanation_panel`

---

### Step 4 — Follow-up Chat
Ask: **"What should I improve to retire earlier?"**

System now has: profile + tax insights + cashflow signals + simulation  
Planner sees enriched context → triggers relevant agents → produces richer answer.

---

## Verifying PII Safety

### What should NOT appear anywhere in storage:
- `$148,500` (exact income)
- `XXX-XX-1234` (SSN pattern)
- `XXXXXX-7892` (account number)
- Any dollar amounts from bank statement

### What SHOULD appear in storage:
- Redis session: `{ taxInsights: { income_range: "HIGH", tax_bracket: "32%", ... } }`
- Markdown: `income_range: HIGH`, `spending_level: MODERATE`
- ChromaDB: `"User in HIGH income bracket, 32% tax bracket, MODERATE deductions"`

### Check session file:
```bash
cat backend/data/sessions/<sessionId>.md
```
Should show only abstract labels, not numbers.

---

## Log Color Reference

| Color | Prefix | Meaning |
|-------|--------|---------|
| Cyan | `[Route]` | HTTP request handling |
| Magenta | `[Agent]` | Agent execution |
| Yellow | `[LangGraph]` | Graph node execution |
| Blue | `[VectorDB]` | ChromaDB operations |
| Cyan | `[Redis]` | Redis operations |
| Gray | `[Warn]` | Degraded mode warning |
| Red | `[Error]` | Error |

---

## Service Status Indicators (Header Dots)

| Color | Meaning |
|-------|---------|
| 🟢 Green | Service running, connected |
| 🟡 Yellow | Fallback mode (in-memory) |
| 🔴 Red | Unavailable |

Fallback mode: system still works — Redis → in-memory Map, ChromaDB → keyword search.

---

## What Each Memory Layer Stores

After a full demo session, you should see:

**Redis key:** `session:<sessionId>`
```json
{
  "profile": { "age": 38, "risk_tolerance": "medium", ... },
  "simulation": { "can_retire_at_target": false, ... },
  "tax": { "tax_efficiency_score": 7, "tax_bracket": "32%", ... },
  "cashflow": { "budget_health": "good", "savings_rate_label": "GOOD", ... }
}
```

**Markdown file:** `backend/data/sessions/<uuid>.md`
- Abstracted profile + simulation + tax + cashflow signals
- PII policy header at top
- Used as LLM context for future turns

**ChromaDB / fallback:**
- Anonymized insight summaries from each session turn
- Enables RAG — past context enriches future responses

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module 'multer'` | Run `cd backend && npm install` |
| LLM not responding | Check `OPENAI_API_KEY` in `.env` or run `ollama serve` |
| Upload returns 400 | Check file is `.txt` or `.json`, field name is `document` |
| Angular compile error | Run `cd frontend && npm install` |
| Port 3000 in use | `lsof -ti:3000 \| xargs kill` |
