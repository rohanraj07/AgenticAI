# AI Financial Planner — How It Works
## Complete Technical & Business Guide

---

## Table of Contents

1. [Business Problem This Solves](#1-business-problem-this-solves)
2. [The Big Picture — What Happens When You Ask a Question](#2-the-big-picture)
3. [A2UI — The Core Innovation](#3-a2ui---the-core-innovation)
4. [A2A — How Agents Talk to Each Other](#4-a2a---how-agents-talk-to-each-other)
5. [Each Component Explained with Business Context](#5-each-component-explained)
6. [The LangGraph Pipeline — Step by Step](#6-the-langgraph-pipeline)
7. [Memory System — Why Three Stores?](#7-memory-system)
8. [RAG — Why the System Gets Smarter Over Time](#8-rag---retrieval-augmented-generation)
9. [Reactive Updates — WebSocket Events](#9-reactive-updates)
10. [Running on Work Laptop — OpenAI vs Ollama](#10-running-on-work-laptop)
11. [What to Change for Different Environments](#11-what-to-change)

---

## 1. Business Problem This Solves

### Traditional financial planning tools are static

A typical financial planning app shows you a dashboard with charts. You enter your data, it shows numbers. If you want to ask **"what if I retire at 55 instead of 65?"**, you manually change inputs, wait, and read the result yourself.

**The problem:**
- You have to know what questions to ask
- You have to navigate to the right screen
- No system-wide re-calculation when one thing changes
- No natural language — it's forms and dropdowns

### What this system does differently

You type **"Can I retire at 55?"** and the system:

1. **Understands your intent** (not keyword matching — actual LLM reasoning)
2. **Decides which analyses to run** (retirement feasibility needs: profile + simulation + portfolio)
3. **Decides which screens to show** (no fixed layout — the AI composes the UI)
4. **Runs all relevant agents** and chains results together
5. **Explains the answer in plain English** with numbers
6. **Remembers** the context across your whole conversation
7. **Updates reactively** — if you say "make it aggressive", the portfolio AND risk recalculate automatically

---

## 2. The Big Picture

```
You type: "Can I retire at 55?"
                │
                ▼
        ┌───────────────┐
        │  Angular Chat │  ← your browser
        │  Component    │
        └───────┬───────┘
                │ POST /api/chat
                ▼
        ┌───────────────────────────────────────────────────┐
        │                 Node.js Backend                   │
        │                                                   │
        │  Step 1: Load your conversation history (Redis)   │
        │  Step 2: Find relevant past context (ChromaDB)    │
        │  Step 3: Run LangGraph pipeline:                  │
        │                                                   │
        │    PlannerAgent ──► decides: run profile,         │
        │         │           simulation, portfolio          │
        │         ▼                                         │
        │    ProfileAgent ──► extracts your financial data  │
        │         │                                         │
        │         ▼                                         │
        │    SimulationAgent ──► projects your savings      │
        │         │                                         │
        │         ▼                                         │
        │    PortfolioAgent ──► recommends allocation       │
        │         │                                         │
        │         ▼                                         │
        │    ExplanationAgent ──► writes plain-English reply│
        │                                                   │
        │  Step 4: Fire events → WebSocket → browser        │
        │  Step 5: Save to Redis + write markdown file      │
        │  Step 6: Embed markdown → store in ChromaDB       │
        └───────────────────────────────────────────────────┘
                │
                ▼ JSON response: { message, ui[], data{}, trace[] }
        ┌───────────────────────────────────────┐
        │  DynamicRendererComponent (Angular)   │
        │  reads ui[] and renders:              │
        │    profile_summary   → ProfileComponent│
        │    simulation_chart  → SimulationComponent│
        │    portfolio_view    → PortfolioComponent│
        │    explanation_panel → ExplanationComponent│
        └───────────────────────────────────────┘
```

---

## 3. A2UI — The Core Innovation

### What is A2UI?

**A2UI = Agent-to-UI**. It means the AI agent decides which UI components to render, not the developer.

### Is the UI fixed or dynamic?

**The UI is fully dynamic.** The server decides what to show based on what the user asked.

Compare this to traditional apps:

| Traditional App | This System (A2UI) |
|----------------|-------------------|
| Developer hardcodes which screens show when | AI decides which components to render |
| User navigates to "Retirement" page manually | AI shows retirement view when you ask about retirement |
| Layout is always the same | Layout adapts to the question |
| Risk screen is separate from simulation | AI shows both together when risk is relevant |

### How it works technically

**Step 1:** The `PlannerAgent` (an LLM) reads your message and returns:

```json
{
  "intent": "Retirement feasibility check",
  "agents": ["profile", "simulation", "portfolio", "explanation"],
  "ui": [
    { "type": "profile_summary" },
    { "type": "simulation_chart" },
    { "type": "portfolio_view" },
    { "type": "explanation_panel" }
  ]
}
```

**Step 2:** Backend sends the `ui[]` array in the HTTP response.

**Step 3:** `DynamicRendererComponent` in Angular reads the array:

```typescript
// DynamicRendererComponent maps type string → Angular component
<app-profile    *ngIf="comp.type === 'profile_summary'">
<app-simulation *ngIf="comp.type === 'simulation_chart'">
<app-portfolio  *ngIf="comp.type === 'portfolio_view'">
<app-risk       *ngIf="comp.type === 'risk_dashboard'">
<app-explanation *ngIf="comp.type === 'explanation_panel'">
```

The UI isn't fetching these components — they're all already loaded in Angular. The `ui[]` array is just a **switching signal** telling DynamicRenderer which ones to make visible.

### A2UI as a Composer

Yes — this is the **Composer pattern**. Instead of the developer writing:
```
"if user is on retirement page, show RetirementComponent"
```

The AI composer says:
```
"this question is about retirement risk, show: simulation_chart + risk_dashboard + explanation_panel"
```

**Different questions → different UI layouts:**

| You ask | Planner decides to show |
|---------|------------------------|
| "Can I retire at 55?" | profile_summary, simulation_chart, portfolio_view, explanation_panel |
| "Show my risk score" | risk_dashboard, explanation_panel |
| "Make it aggressive" | portfolio_view, risk_dashboard, explanation_panel |
| "What's my runway?" | simulation_chart, explanation_panel |

The developer never hardcodes "show risk when user asks about risk." The AI figures it out.

---

## 4. A2A — How Agents Talk to Each Other

**A2A = Agent-to-Agent**. Agents don't call each other directly — they communicate through **shared state** in the LangGraph pipeline.

### The state object flows through the graph

```
Initial state:
  { message: "Can I retire at 55?", profile: null, simulation: null, ... }

After PlannerAgent:
  { plan: { agents: ["profile","simulation",...], ui: [...] }, ... }

After ProfileAgent:
  { profile: { age:42, savings:380000, risk_tolerance:"medium" }, ... }

After SimulationAgent (reads profile from state):
  { simulation: { can_retire: false, projected: 720000 }, ... }

After PortfolioAgent (reads profile + simulation):
  { portfolio: { allocation:[...], strategy:"balanced" }, ... }

After ExplanationAgent (reads everything):
  { explanation: "Based on your $380k savings..." }
```

Each agent **reads** from state and **writes** to state. This is A2A: agents pass their results as structured data that downstream agents consume.

**Why this matters for business:** If you say "I just got a raise to $150k", the ProfileAgent updates the profile, which causes the SimulationAgent to re-run with new numbers, which updates the PortfolioAgent's recommendations — automatically, in sequence.

---

## 5. Each Component Explained

### Backend Components

#### `PlannerAgent` — The Orchestrator
**File:** `backend/agents/planner.agent.js`

**Business role:** Chief of staff. Reads what you asked and assigns the right specialists.

**What it does:**
- Receives raw natural language input
- Uses the LLM to classify intent
- Returns a JSON plan: which agents to run, which UI to show

**Why we need it:** Without this, every message would run ALL agents every time. For "Show my risk score", we don't need to re-extract your profile. The planner skips unnecessary work.

---

#### `ProfileAgent` — The Data Extractor
**File:** `backend/agents/profile.agent.js`

**Business role:** Intake specialist. Captures your financial details from conversation.

**What it does:**
- Reads your message + conversation history + past session context
- Extracts structured financial data: age, income, savings, expenses, retirement age, risk tolerance
- Returns a typed JSON object

**Why we need it:** Users don't fill in forms — they talk naturally. "I'm 42, make around 120k, and have about 380 thousand saved" becomes `{ age: 42, income: 120000, savings: 380000 }`. The agent handles abbreviations, currency formats, and ambiguity.

---

#### `SimulationAgent` — The Financial Modeller
**File:** `backend/agents/simulation.agent.js`

**Business role:** Quantitative analyst. Runs the numbers.

**What it does:**
- Takes your profile as input
- Calculates: projected savings at retirement, monthly surplus/shortfall, years of runway
- Generates year-by-year milestones
- Answers: "Can you actually retire when you want to?"

**Why we need it:** This is the core value — translating your financial situation into a concrete yes/no with supporting numbers. A human advisor does the same calculation; we automate it.

**Sample output:**
```json
{
  "can_retire_at_target": false,
  "projected_savings_at_retirement": 720000,
  "monthly_shortfall_or_surplus": -1200,
  "years_of_runway": 15,
  "summary": "At current savings rate you will have $720k at 55, but need ~$1.92M to sustain your lifestyle."
}
```

---

#### `PortfolioAgent` — The Investment Adviser
**File:** `backend/agents/portfolio.agent.js`

**Business role:** Wealth manager. Recommends how to invest.

**What it does:**
- Takes your profile (especially risk tolerance) + simulation results
- Recommends asset allocation (equities, bonds, real estate, cash)
- Chooses a strategy (conservative / balanced / aggressive)
- Explains the rationale

**Why we need it:** The simulation might show a shortfall. The portfolio recommendation is the *solution* — invest more aggressively, or shift to higher-yield assets. Advice is tailored to your specific numbers, not generic.

---

#### `RiskAgent` — The Risk Assessor
**File:** `backend/agents/risk.agent.js`

**Business role:** Risk management team. Protects against downside.

**What it does:**
- Scores your overall financial risk (1-10)
- Identifies specific risk factors (market volatility, timeline risk, inflation)
- Runs stress tests: "what if the market drops 20%?"
- Suggests mitigations

**Why we need it:** A plan that works in normal conditions but collapses in a downturn isn't a real plan. Risk assessment is what separates amateur advice from professional financial planning.

---

#### `ExplanationAgent` — The Communicator
**File:** `backend/agents/explanation.agent.js`

**Business role:** Client relationship manager. Translates numbers into language.

**What it does:**
- Reads all agent outputs
- Writes a plain-English answer to your specific question
- References your actual numbers
- Addresses your question directly

**Why we need it:** You asked "Can I retire at 55?" — not "give me a JSON simulation object". The explanation agent bridges the gap between machine output and human understanding.

---

### Frontend Components

#### `ChatComponent` — The Interface
**File:** `frontend/src/app/components/chat/chat.component.ts`

**What it does:**
- Receives user input (text or quick-action buttons)
- Sends to backend, shows loading state
- Displays AI responses as chat bubbles
- Auto-scrolls, re-focuses input after each reply
- Connects to WebSocket for live updates

---

#### `DynamicRendererComponent` — The A2UI Engine
**File:** `frontend/src/app/components/dynamic-renderer/dynamic-renderer.component.ts`

**What it does:**
- Receives `ui[]` array from backend response
- For each entry, conditionally renders the matching Angular component
- This is the heart of A2UI — zero hardcoded layout logic

**Key code:**
```typescript
// Server says: { type: "portfolio_view" }
// Angular shows: PortfolioComponent
<app-portfolio *ngIf="comp.type === 'portfolio_view'" [portfolio]="portfolio">
```

---

#### `ProfileFormComponent` — User Data Entry
**File:** `frontend/src/app/components/profile-form/profile-form.component.ts`

**What it does:**
- Collects structured financial data via a form (before the first chat)
- On submit, sends it as a structured natural language message
- Collapses to a compact summary after submission
- The ProfileAgent extracts the data from this message

---

#### `TracePanelComponent` — Observability
**File:** `frontend/src/app/components/trace-panel/trace-panel.component.ts`

**What it does:**
- Shows execution timeline: which agents ran and how long each took
- Visualises agent latency as proportional bars
- Helps understand why a response took a certain amount of time

**Business value:** In a production system, this is your SLA monitoring — you can see if simulation is slow (LLM issue), or if the planner is routing correctly.

---

### Infrastructure Components

#### LangChain Chains
**File:** `backend/langchain/chains.js`

Each agent has a **Chain**: `PromptTemplate → LLM → OutputParser`

```
PromptTemplate: fills in variables into a structured prompt
     ↓
LLM (Ollama/OpenAI): generates a response
     ↓
JsonOutputParser: parses the LLM response into a typed object
```

**Why LangChain:** Standardises how we talk to different LLMs. Switching from Ollama to OpenAI is one line. The chain handles retries, streaming, and output parsing.

---

#### LangGraph DAG
**File:** `backend/langgraph/graph.js`

A **Directed Acyclic Graph** of agent nodes with conditional routing.

```
node_planner
    │
    ├── (if agents includes "profile")    → node_profile
    ├── (if agents includes "simulation") → node_simulation
    ├── (if agents includes "portfolio")  → node_portfolio
    └── (else)                            → node_explanation
```

**Why LangGraph:** Without it, you'd write `if/else` chains to decide which agents to call. LangGraph lets you define the flow declaratively and handles state propagation automatically.

---

## 6. The LangGraph Pipeline

### Full flow for "Can I retire at 55?"

```
User input: "Can I retire at 55?"
     │
     ▼
[node_planner]
  Prompt: "Decide which agents to run for: 'Can I retire at 55?'"
  LLM thinks: "This needs profile + simulation + portfolio + explanation"
  Returns plan:
    agents: [profile, simulation, portfolio, explanation]
    ui: [profile_summary, simulation_chart, portfolio_view, explanation_panel]
  → routes to node_profile
     │
     ▼
[node_profile]
  Prompt: "Extract financial profile from: [message] [conversation history]"
  LLM extracts: { age: 42, income: 120000, savings: 380000, retire_at: 55 }
  → routes to node_simulation
     │
     ▼
[node_simulation]
  Prompt: "Run financial projection for: [profile JSON]"
  LLM calculates: { can_retire: false, projected: 720000, shortfall: -1200 }
  → routes to node_portfolio
     │
     ▼
[node_portfolio]
  Prompt: "Recommend investments for: [profile] [simulation]"
  LLM recommends: { allocation: [55% equity, 30% bonds, ...], strategy: balanced }
  → routes to node_explanation (no risk in plan)
     │
     ▼
[node_explanation]
  Prompt: "Explain to user: [profile] [simulation] [portfolio] — Question: 'Can I retire at 55?'"
  LLM writes: "Based on your current savings of $380k, retiring at 55 will be challenging..."
  → END
```

### For "Show my risk score" (different path)

```
[node_planner]
  agents: [risk, explanation]
  ui: [risk_dashboard, explanation_panel]
  → routes directly to node_risk (skips profile, simulation, portfolio)

[node_risk]
  Uses DEFAULT_PROFILE or existing session profile
  Returns: { score: 6, level: "medium", factors: [...] }
  → node_explanation → END
```

This is why LangGraph conditional routing matters — it's not "run everything every time."

---

## 7. Memory System

### Why three different stores?

| Store | Technology | What's stored | Why |
|-------|-----------|--------------|-----|
| **Session store** | Redis | Structured JSON (profile, simulation, portfolio, risk) | Fast read/write for real-time state; survives page refresh |
| **Context memory** | Markdown files | Human-readable session summary | The LLM reads English better than JSON; used as context injection |
| **Semantic memory** | ChromaDB | Vector embeddings of session snapshots | Enables similarity search across sessions — "RAG" |

### How they work together

```
After each conversation turn:

1. Redis stores: { profile: {...}, simulation: {...} }
   Purpose: Fast retrieval on next request

2. Markdown writes: data/sessions/<id>.md
   Purpose: Next turn injects this as LLM context
   "Remember: last time, user had $380k savings, couldn't retire at 55"

3. ChromaDB stores: embedding(markdown)
   Purpose: Semantic search — "find sessions similar to this question"
```

**Business value of 3-store approach:**
- Redis = speed (milliseconds)
- Markdown = LLM comprehension (models understand prose)
- ChromaDB = intelligence (similar questions get similar context)

---

## 8. RAG — Retrieval Augmented Generation

### The problem RAG solves

An LLM has no memory by default. Every conversation starts fresh. Without RAG, if you said "I earn $120k" in message 1 and then asked "how much should I save?" in message 3, the LLM wouldn't remember your income.

### How RAG works in this system

**At the end of each turn:**
```
Session snapshot (markdown) → embed with Ollama/OpenAI → store in ChromaDB
```

**At the start of each turn:**
```
New user message → embed → search ChromaDB → retrieve top-5 similar past contexts
                                                     ↓
                              inject into agent prompts as "RAG context"
```

**Example:** You said "I earn $120k" in turn 1. In turn 5, you ask "what's my monthly budget?" The RAG retrieval finds your turn-1 snapshot, extracts your income, and injects it into the prompt — so the LLM knows your income without you repeating it.

**Why this matters for business:** Users shouldn't have to repeat themselves. A real financial advisor remembers your entire history. RAG is how we give the AI the same capability.

---

## 9. Reactive Updates

### How WebSocket events work

Every time an agent completes, the backend fires an event:

```javascript
// After ProfileAgent completes:
eventEmitter.emit('PROFILE_UPDATED', { sessionId, profile })

// WebSocket route listener:
eventEmitter.on('PROFILE_UPDATED', ({ sessionId, profile }) => {
  broadcast(sessionId, { type: 'PROFILE_UPDATED', data: profile })
})

// Angular WebSocketService:
ws.onmessage → messages$ Subject → components subscribe
```

**Why reactive matters for business:**
- In a full production system, multiple users could be sharing a financial planning session (e.g., a couple reviewing finances together)
- Each person sees updates in real-time as agents complete
- The UI doesn't wait for the full pipeline — it updates progressively as each agent finishes
- This creates a "thinking in progress" feel rather than a long blank wait

---

## 10. Running on Work Laptop

### What actually needs to run

| Service | Needed? | Can it run on work laptop? |
|---------|---------|--------------------------|
| **Backend (Node.js)** | Yes | Yes — just Node.js |
| **Frontend (Angular)** | Yes | Yes — just Node.js |
| **LLM (Ollama)** | Yes | Use **OpenAI** instead |
| **Redis** | No | Auto falls back to in-memory |
| **ChromaDB** | No | Auto falls back to keyword search |

### Minimal setup for work laptop

```bash
# 1. Get an OpenAI API key: https://platform.openai.com/api-keys
# 2. Edit backend/.env:
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini

# 3. Start backend (that's it — Redis/Chroma fallbacks kick in automatically)
cd backend && npm install && npm run dev

# 4. Start frontend
cd frontend && npm install && npm start
```

**Cost estimate for demo:**
- GPT-4o-mini: ~$0.15/1M input tokens, ~$0.60/1M output tokens
- A typical conversation turn uses ~2,000-4,000 tokens
- 20 demo turns ≈ $0.01-0.05 total

**What you lose vs full setup:**
- No semantic memory persistence (keyword search only — less smart context)
- No session persistence across restarts (data lives in-memory)
- Slightly slower than Ollama for large models (network latency)

**What still works perfectly:**
- All 6 agents
- A2UI dynamic rendering
- LangGraph pipeline
- All Angular components
- WebSocket events
- Trace panel

---

## 11. What to Change for Different Environments

### To switch from Ollama → OpenAI

In `backend/.env`, uncomment:
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Nothing else changes. The `llm.js` auto-detects and uses the right provider.

### To add persistent sessions (Redis)

```bash
# Docker (any machine with Docker):
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

No code changes needed. The fallback automatically stops being used.

### To add semantic RAG (ChromaDB)

```bash
# Docker:
docker run -d --name chromadb -p 8000:8000 chromadb/chroma
```

No code changes needed.

### To use a different OpenAI model

In `.env`:
```
OPENAI_MODEL=gpt-4o          # more capable, more expensive
OPENAI_MODEL=gpt-4o-mini     # recommended for demo (cheap + fast)
OPENAI_MODEL=gpt-3.5-turbo   # cheapest option
```

### To point to a different Ollama model

```
OLLAMA_MODEL=mistral
OLLAMA_MODEL=llama3.1
OLLAMA_MODEL=gemma2
```

---

## Quick Reference: Which File Controls What

| What you want to change | File |
|------------------------|------|
| LLM provider (OpenAI/Ollama) | `backend/.env` → `OPENAI_API_KEY` |
| Agent prompts | `backend/langchain/prompts.js` |
| Which agents run | `backend/langgraph/graph.js` (routing functions) |
| What UI shows for each answer | `backend/agents/planner.agent.js` (prompt) |
| UI component mapping | `frontend/src/app/components/dynamic-renderer/` |
| Chat appearance | `frontend/src/styles.css` |
| Session memory duration | `backend/.env` → `SESSION_TTL_SECONDS` |
| Number of RAG results | `backend/.env` → `TOP_K_RESULTS` |
