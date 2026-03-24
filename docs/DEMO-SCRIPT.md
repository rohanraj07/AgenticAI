# Demo Script — AI Financial Planner
> Presenter voice. Hackathon edition.
> Total runtime: 8–10 minutes. Practice it until it's 7.

---

## Pre-Demo Checklist (5 minutes before)

```bash
# Terminal 1 — backend with visible logs
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm start

# Browser tabs pre-opened:
#   Tab 1: http://localhost:4200   (app — full screen)
#   Tab 2: DevTools Network tab    (pre-opened, filter: /api)
#   Tab 3: Terminal with logs      (visible on second monitor or split)

# Reset any prior session state
rm -f backend/data/sessions/*.md
redis-cli FLUSHALL 2>/dev/null || true

# Sample files ready to drag-drop
open backend/data/   # confirm sample-tax-document.txt and sample-bank-statement.txt exist
```

**Font size**: terminal 18pt, browser 110% zoom. Everyone in the back must read it.

**Split your screen**: Browser left (70%) · Terminal logs right (30%).

---

## The Setup — What to Say Before Touching the Keyboard

> *"Every AI financial tool does the same thing: you ask a question, the AI generates an answer. Sometimes the numbers are right. Sometimes they're not. And you have no way to tell the difference."*

> *"We built something different. This is not an AI that gives you answers. This is a financial engine where AI orchestrates the experience — and math provides the guarantees."*

> *"Let me show you exactly what that means."*

---

## ACT 1 — The First Question (90 seconds)

### What you do
Type in the chat: **"I'm 32 years old, make $95,000 a year, have $60,000 saved, and want to retire at 60. Can I do it?"**

Hit Send.

### What happens (watch the logs right side)
```
[ReactiveEngine] seeded session=... from Redis
[Agent] PlannerAgent — intent: Retirement feasibility check
[Agent] ProfileAgent — extracted profile
[Agent] SimulationAgent [1/2] deterministic projection
[Agent]   Projected savings: $X,XXX,XXX   ← point at this
[Agent] SimulationAgent [2/2] LLM summary
```

### What to say while it loads
> *"Watch the right side. The agent pipeline is running. Profile agent extracted the numbers I just typed. Now — this is important — the simulation agent is not asking an AI 'what will my savings be?' It's running compound interest math. That number you see in the logs is the same number you'll see every single time for these inputs."*

### When the panels appear
Point at the simulation chart first.

> *"There it is. Projected savings, required savings, the gap — all computed deterministically. The AI wrote this summary sentence, but it didn't compute a single dollar of that number."*

Point at the profile panel.

> *"Profile panel — extracted from my natural language. I said '32 years old, $95k, $60k saved' — no form, no form fields."*

Point at the explanation panel.

> *"And the explanation agent synthesised everything into plain English. This is the only part that varies between runs. The numbers? Never."*

**Pause. Let it breathe.**

> *"Let me prove it."*

### The proof moment — run it again
Type the EXACT same message again.

> *"Same message. Watch the number."*

Point at the logs — same projected savings figure appears.

> *"$X,XXX,XXX. Identical. You cannot get a different number for the same inputs. The AI cannot hallucinate a projection in this system."*

---

## ACT 2 — The A2UI Reveal (90 seconds)

> *"Now let me show you something most AI demos never show you — the API response."*

### Switch to Network tab
Click on the `/api/chat` request → Response tab.

Zoom into the `ui` array.

> *"Most systems return a flat list like `[{type: 'simulation_chart'}]`. That's it. The frontend figures out the rest."*

> *"We return this."*

Scroll through one component slowly — point at each field:

```json
{
  "id": "simulation_chart-1",
  "type": "simulation_chart",
  "loading": false,
  "version": 4,
  "data": { "projected_savings_at_retirement": ... },
  "meta": {
    "priority": "high",
    "layout": "full_width",
    "trigger": "SIMULATION_UPDATED"
  },
  "insight": {
    "reason": "User asked about retirement feasibility",
    "summary": "On track — $X.XM projected vs $X.XM required",
    "confidence": 0.9
  },
  "actions": [
    { "label": "Adjust retirement age", "action": "EDIT_RETIREMENT_AGE" }
  ]
}
```

> *"The server answers four questions for every single panel:"*

Point at each field as you say it:
> - `insight.reason` — **WHY** is this panel here?
> - `insight.summary` — **WHAT** does the data show?
> - `meta.priority + meta.layout` — **HOW** should it look?
> - `meta.trigger` — **WHEN** does it refresh?

> *"The frontend renders what it's told. It has zero opinion about layout, zero opinion about which panels are relevant. A new panel can be added to this system without a single frontend change — it's a server-side config update."*

> *"We call this A2UI — Agent-to-UI. The agent orchestrates the interface, not just the answer."*

---

## ACT 3 — The Reactive Engine (60 seconds)

> *"Now watch what happens when data changes."*

### What you do
Type: **"Actually, I just got a raise. My income is now $120,000."**

### Point at logs immediately
```
[ReactiveEngine] PROFILE_UPDATED → FULL cascade | agents=[simulation, portfolio, risk]
[ReactiveEngine] ✔ simulation recomputed (2ms)
[ReactiveEngine] ✔ portfolio recomputed (1ms)
[ReactiveEngine] ✔ risk recomputed (1ms)
```

> *"2 milliseconds. That's not an AI call. That's math."*

> *"When income changed, the system automatically re-ran simulation, portfolio allocation, and risk score. I didn't ask it to. No prompt told it to. It's a hardcoded dependency graph — `PROFILE_UPDATED` always triggers those three, in that order, every time."*

> *"The panels just updated. Notice the simulation chart shifted. The numbers moved. All in under 10ms total."*

> *"If this was an LLM making those decisions, it would cost 3-5 seconds and could forget to recompute risk. We guarantee recomputation in code, not in a prompt."*

---

## ACT 4 — The Document Upload + Trust Story (2 minutes)

> *"Now for the most important part of this demo."*

> *"Financial planning means sensitive documents. Tax returns. Bank statements. The standard approach: upload the file, store it, run analysis. We did something different."*

### Drag and drop `sample-tax-document.txt`

While it uploads:
> *"File is uploading. In-memory only. The moment this request ends, the raw file is gone."*

### When panels update — point at tax panel
> *"Tax panel appeared. The system analysed the document — found a 22% tax bracket, upper-middle income range, identified three optimisation strategies."*

> *"But I want to show you something."*

### Open a new terminal tab
```bash
cat backend/data/sessions/<sessionId>.md
```

Point at the file contents:

> *"This is everything we stored about that document. Look at the income field."*

Point at `income_range: UPPER_MIDDLE`

> *"Not $145,000. `UPPER_MIDDLE`. The exact figure never left memory."*

> *"Look for an SSN. Look for an account number."*

Point at the file.

> *"It's not there. Because the pipeline doesn't expose a path for it. The PII sanitizer runs synchronously, in the same function call as extraction, before anything async touches the data. You cannot store raw PII even if you wanted to — the architecture prevents it."*

**Pause.**

> *"This is trust-by-design. Not trust-by-policy."*

### Now show the conflict resolution moment
> *"Here's something subtle. Before the upload, I said my income was $95k. The tax document implied upper-middle income — higher. Watch what our conflict resolver did."*

Point at logs:
```
[ConflictResolver] field="income" resolved → source=document_extracted confidence=1
[ConflictResolver] mergeProfiles complete — source=document_extracted
[ConflictResolver] scoreDataQuality → 0.857
```

> *"Document data outranks what you typed. Not because an AI decided that — because we defined a precedence table: document_extracted beats user_stated beats inferred. The simulation automatically updated with the higher-confidence data."*

---

## ACT 5 — The Priority Queue (45 seconds)

> *"One more thing I want to show you — what happens under load."*

### What you do
Type three messages in rapid succession (don't wait for responses):
1. **"Change my retirement age to 55"**
2. **"Actually make it 58"**
3. **"No, 56 is better"**

### Point at logs
```
[ReactiveEngine] PROFILE_UPDATED → FULL cascade | session=...
[ReactiveEngine] queued PROFILE_UPDATED (cascade in progress) session=...
[ReactiveEngine] queued PROFILE_UPDATED (cascade in progress) session=...
[ReactiveEngine] ✔ simulation recomputed (2ms)
... (one more cascade runs after first completes)
```

> *"Three profile updates. The system ran exactly two cascades — not three. The second and third events were coalesced into one. Same result. Less compute."*

> *"And if a profile update and a tax update arrive at the same time — the profile update goes first. It's higher priority. The system processes `PROFILE_UPDATED` before `TAX_UPDATED`, always, because a profile change cascades to more downstream agents."*

> *"This is a priority queue with deduplication. Not something you'd typically build in a hackathon POC — but it's what makes this production-ready."*

---

## ACT 6 — The Bank Statement (30 seconds)

### Drag and drop `sample-bank-statement.txt`

> *"Bank statement."*

Wait for cashflow panel to appear.

> *"Cashflow panel. Spending level, savings rate, budget health, three recommendations. All from abstracted signals — not transaction data. The raw statement is already gone."*

> *"Now ask a follow-up question."*

Type: **"What's the single most important thing I should change to retire 3 years earlier?"**

> *"Watch this — it remembers everything. The tax insights, the cashflow signals, the profile, the simulation. It's using all of it to answer. No re-upload. No re-prompting. The session state is the memory."*

---

## ACT 7 — The Close (60 seconds)

> *"Let me tell you what we did NOT do."*

> *"We did not let an AI compute your savings projections. That's a math problem — we solved it with math."*

> *"We did not let an AI decide your UI layout. That's a design problem — we solved it with a component registry."*

> *"We did not let an AI choose which panels to refresh when income changes. That's a dependency problem — we solved it with a graph."*

> *"And we did not let an AI decide whose data wins when you type one thing and your tax return says another. That's a trust problem — we solved it with a precedence table."*

**Pause. Step back from the keyboard.**

> *"What we did let the AI do: understand what you meant, explain what it found, and tell the UI what to show and why."*

> *"That's the boundary. And when you draw that boundary clearly, you get something most AI systems never achieve — a system that is reactive, consistent, deterministic where it needs to be, and explainable at every step."*

> *"We call it an A2UI orchestration platform. The agent doesn't just answer your question. It orchestrates your entire experience."*

> *"Thank you."*

---

## Backup Moments (if judges ask questions)

### "How is this different from just hardcoding the UI?"
> *"The planner LLM decides WHICH panels are relevant to the user's question. If someone asks about taxes, the planner includes the tax panel. If they ask about investments, it includes portfolio. The server decides HOW to display it — layout, priority, actions. New business logic (new panel, new trigger) is a server deploy, never a frontend deploy."*

### "What if the LLM is wrong about which panels to show?"
> *"The planner has guardrails enforced in code — `explanation` is always present, `portfolio` always requires `simulation` first, `risk` always requires `portfolio`. The LLM can choose from the list, but code enforces the constraints. And there's a `SAFE_DEFAULT_PLAN` fallback if the chain fails entirely."*

### "What about real financial data? This is sample data."
> *"The architecture is designed for real integrations. Swap `financial.calculator.js` with a Bloomberg or Morningstar API — same interface, same cascade. Swap the LLM with a fine-tuned model — same prompts. The compute layer is completely pluggable."*

### "Why not just use an LLM for everything?"
> *"Because $2,865,086 should not be a matter of opinion. When you ask an LLM to calculate compound interest, it gives you a different answer every time — and the answers are often wrong. We use the LLM for what it's genuinely good at: understanding language and explaining results. Math is for math."*

### "What's the biggest technical risk?"
> *"The single process state manager doesn't scale horizontally. In production you'd replace `StateManager._store` with a Redis hash — same interface. We designed for that swap explicitly. The reactive engine would work identically with shared Redis state."*

---

## Technical Highlights Card (for judge handout or slide)

```
┌─────────────────────────────────────────────────────────┐
│  AI Financial Planner — Technical Summary               │
├─────────────────────────────────────────────────────────┤
│  A2UI v2 Protocol                                        │
│  Server returns: {id, type, data, meta, insight,        │
│    actions, version} per panel                          │
│  WHAT/WHY/HOW/WHEN answered by backend — not frontend   │
├─────────────────────────────────────────────────────────┤
│  Deterministic Compute                                   │
│  Projection = FV formula, not LLM                       │
│  Risk score = 3-factor formula, not LLM                 │
│  Portfolio = glide-path formula, not LLM                │
│  Same inputs → same numbers, always                     │
├─────────────────────────────────────────────────────────┤
│  Reactive Engine (zero LLM)                             │
│  PROFILE_UPDATED → FULL cascade (sim+portfolio+risk)    │
│  TAX_UPDATED → PARTIAL cascade (sim only)               │
│  Each step: ~1–3ms deterministic                        │
├─────────────────────────────────────────────────────────┤
│  Priority Event Queue                                    │
│  HIGH(1)=PROFILE, MEDIUM(2)=TAX/CASHFLOW, LOW(3)=UI    │
│  Coalescing: 3× same event → 1 cascade entry           │
│  No overlapping cascades per session                    │
├─────────────────────────────────────────────────────────┤
│  Conflict Resolution                                     │
│  document_extracted(4) > user_stated(3) > inferred(2)  │
│  Data quality score: 0.0–1.0 per session               │
├─────────────────────────────────────────────────────────┤
│  Trust-by-Design (not trust-by-policy)                  │
│  Raw file: in-memory buffer only, never on disk         │
│  PII abstracted in same function call as extraction     │
│  Stored: income_range="UPPER_MIDDLE" not $145,000       │
│  Architecture prevents PII storage — no bypass path    │
├─────────────────────────────────────────────────────────┤
│  Stack: LangGraph + LangChain · Angular 17 · Node.js   │
│  LLM: Groq/Gemini/OpenAI/Ollama (priority chain)       │
│  State: Redis (versioned) + in-process StateManager    │
│  Memory: Redis + ChromaDB + Markdown                    │
└─────────────────────────────────────────────────────────┘
```

---

## Timing Guide

| Act | Topic | Time |
|-----|-------|------|
| Setup | Problem statement | 30s |
| 1 | First question + determinism proof | 90s |
| 2 | A2UI v2 network tab reveal | 90s |
| 3 | Reactive engine (income change) | 60s |
| 4 | Document upload + trust story | 120s |
| 5 | Priority queue demo | 45s |
| 6 | Bank statement + memory | 30s |
| 7 | Close | 60s |
| **Total** | | **~8.5 min** |

> Aim for 7.5 minutes. Judges respect demos that don't run over.

---

## The One Line That Wins

If you get 30 seconds and nothing else:

> *"Every other AI system gives you a smart answer. This one gives you a smart interface — the AI orchestrates what you see, not just what it says. And every number you see came from math, not the model."*
