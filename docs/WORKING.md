# How the System Works — Complete Technical Guide

## What happens when you send a message

When you type "Can I retire at 55?" and click Send, here is the exact sequence:

```
Browser → POST /api/chat
        → ChatRoute receives request
        → Redis: load session history
        → ChromaDB: semantic search for relevant past context (RAG)
        → LangGraph pipeline starts:
              node_planner  → decides which agents to run
              node_profile  → extracts your financial data
              node_simulation → runs financial projections
              node_portfolio → recommends investments
              node_risk     → scores your risk
              node_explanation → writes plain-English answer
        → Each completed agent fires an EventEmitter event
        → WebSocket broadcasts events to browser in real-time
        → Redis: save updated session
        → ChromaDB: store session snapshot as vector embedding
        → Markdown: write human-readable session file
        → Response: { message, ui[], data{}, trace[] }
        → Angular: DynamicRenderer maps ui[] → components
```

---

## Starting all services

### 1. Ollama (LLM)

```bash
# Install: https://ollama.ai (Mac: brew install ollama)
ollama serve               # starts API on http://localhost:11434
ollama pull llama3.2       # download model once (~2 GB)

# Verify:
curl http://localhost:11434/api/tags
# Expected: {"models":[{"name":"llama3.2:latest",...}]}
```

### 2. Redis (session memory)

```bash
# Option A — Docker (recommended)
docker run -d --name redis-fp -p 6379:6379 redis:7-alpine

# Option B — Homebrew
brew install redis && redis-server

# Verify:
redis-cli ping
# Expected: PONG

# See active sessions:
redis-cli keys "session:*"
redis-cli get "session:<your-session-id>"
```

### 3. ChromaDB (vector database / RAG)

```bash
# Option A — Docker (recommended, no Python needed)
docker run -d --name chromadb -p 8000:8000 chromadb/chroma

# Option B — Python
python3 -m pip install chromadb
python3 -m chromadb run --port 8000

# Verify:
curl http://localhost:8000/api/v1/heartbeat
# Expected: {"nanosecond heartbeat": ...}
```

### 4. Backend

```bash
cd backend
npm install
npm run dev

# Expected startup output:
# [Redis] Connected to Redis at localhost : 6379
# [VectorDB] ChromaDB connected — collection: financial_memory
# [Server] HTTP + WebSocket listening on port 3000
# [LangGraph] Financial graph compiled — nodes: planner→...

# If Redis not running:
# [Warn] Redis unavailable — using in-memory session store
# If ChromaDB not running:
# [Warn] ChromaDB unavailable — using in-memory keyword fallback
```

### 5. Frontend

```bash
cd frontend
npm install
npm start
# Opens http://localhost:4200
```

---

## Reading the logs

Every backend log line has format:
```
[Component] HH:MM:SS.mmm  message
```

### What a full request looks like in logs

```
[Route]     12:34:56.001  POST /chat | session: abc-123
[Route]     12:34:56.002    message: "Can I retire at 55?"
[Redis]     12:34:56.003  GET session:abc-123 → miss
[Redis]     12:34:56.004  [fallback] GET session:abc-123 → miss
[VectorDB]  12:34:56.005  SEARCH query: Can I retire at 55?
[VectorDB]  12:34:56.006    → fallback keyword search: 0 results
[Route]     12:34:56.007    RAG: context retrieved (0 chars)
[Route]     12:34:56.008    Markdown memory: empty (first session)
[Redis]     12:34:56.009  appendMessage abc-123 role=user total=1 msgs
[LangGraph] 12:34:56.010  ▶ node_planner START | message: Can I retire...
[LangChain] 12:34:56.011  plannerChain invoked
[Agent]     12:34:56.200  PlannerAgent response received
[LangGraph] 12:34:56.201  ✔ node_planner DONE (191ms) | intent: "Retirement feasibility check" | agents: [profile, simulation, portfolio, explanation] | ui: [profile_summary, simulation_chart, portfolio_view, explanation_panel]
[LangGraph] 12:34:56.201    route after planner → node_profile
[LangGraph] 12:34:56.202  ▶ node_profile START
[LangGraph] 12:34:58.500  ✔ node_profile DONE (2298ms) | name: Alex, age: 42, income: $120000, savings: $380000, risk: medium
[LangGraph] 12:34:58.500    route after profile → node_simulation
[LangGraph] 12:34:58.501  ▶ node_simulation START | profile: age=42, savings=$380000, retire_at=55
[LangGraph] 12:35:01.200  ✔ node_simulation DONE (2699ms) | can_retire=false | projected=$720000 | surplus/shortfall=$-1200/mo | runway=15yrs
[LangGraph] 12:35:01.200    Summary: "Based on current savings rate, retiring at 55 is challenging..."
[LangGraph] 12:35:01.201    route after simulation → node_portfolio
[LangGraph] 12:35:01.201  ▶ node_portfolio START | risk_tolerance: medium
[LangGraph] 12:35:03.800  ✔ node_portfolio DONE (2599ms) | strategy: balanced | return: 6.8%/yr | allocation: [Equities:55%, Bonds:30%, Real Estate:10%, Cash:5%]
[LangGraph] 12:35:03.800    Rationale: "Medium risk at age 42 warrants balanced equity/bond split..."
[LangGraph] 12:35:03.801    route after portfolio → node_explanation
[LangGraph] 12:35:03.801  ▶ node_explanation START
[LangGraph] 12:35:06.100  ✔ node_explanation DONE (2299ms) | response (412 chars): "Based on your current savings of $380,000..."
[Route]     12:35:06.100    LangGraph: pipeline complete (9899ms)
[Route]     12:35:06.101    → profile saved & event emitted
[Route]     12:35:06.102    → simulation saved | can_retire=false | projected=$720000
[Route]     12:35:06.103    → portfolio saved | strategy=balanced | return=6.8%
[Redis]     12:35:06.104  SET session:abc-123 (TTL 3600s, 2847 bytes)
[Route]     12:35:06.105    Writing markdown memory snapshot...
[Route]     12:35:06.106    Markdown written to data/sessions/abc-123.md (1243 chars)
[VectorDB]  12:35:06.107  ADD doc session:abc-123:1710000000 (1243 chars)
[VectorDB]  12:35:06.108    → embedding document...
[VectorDB]  12:35:06.900    → embedding done, dims: 4096
[VectorDB]  12:35:06.901    → stored in ChromaDB
[Route]     12:35:06.902    Trace: [planner:191ms → profile:2298ms → simulation:2699ms → portfolio:2599ms → explanation:2299ms] total=10086ms
[Route]     12:35:06.903    Response sent | ui=[profile_summary, simulation_chart, portfolio_view, explanation_panel] | total=10902ms
```

---

## The session .md files

Found in: `backend/data/sessions/<sessionId>.md`

These are **human-readable financial planning snapshots** written after each conversation turn. They serve two purposes:

1. **LLM context** — injected into agent prompts so the LLM remembers previous conversation state
2. **RAG source** — converted to vector embeddings and stored in ChromaDB for semantic retrieval

Example file (`data/sessions/abc-123.md`):
```markdown
# Financial Planning Session: abc-123

## User Profile
- **Name**: Alex Johnson
- **Age**: 42
- **Income**: $120,000
- **Savings**: $380,000
- **Monthly Expenses**: $4,200
- **Retirement Age**: 55
- **Risk Tolerance**: medium

## Simulation Results
- **Can Retire At Target**: false
- **Projected Savings**: $720,000
- **Monthly Surplus/Shortfall**: -$1,200
...
```

Each turn overwrites the previous snapshot and re-embeds it into ChromaDB. This is how the system "remembers" your financial situation across messages.

---

## What projections are made and why

### SimulationAgent projections
Given your **age, income, savings, monthly expenses, and target retirement age**, it calculates:

| Metric | How calculated |
|--------|----------------|
| `projected_savings_at_retirement` | savings + (income - expenses × 12) × years_to_retire × compound_factor |
| `monthly_shortfall_or_surplus` | (projected/years_of_runway/12) - monthly_expenses |
| `years_of_runway` | projected_savings / monthly_expenses / 12 |
| `can_retire_at_target` | true if monthly_surplus >= 0 |

### PortfolioAgent rationale
Given **risk tolerance + simulation results**, it recommends:
- `low` risk → heavy bonds (60%+ bonds, 30% equities)
- `medium` risk → balanced (55% equities, 30% bonds, 10% real estate)
- `high` risk → aggressive (75%+ equities, minimal bonds)

### RiskAgent stress test
- `market_crash_20pct_impact`: equity portion × 0.20 = potential loss in 20% market downturn
- `inflation_spike_impact`: monthly_expenses × 12 × 3% × years_to_retire = cumulative inflation erosion

---

## Architecture diagram (detailed)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Angular 17)                                           │
│  ┌─────────────┐   ┌───────────────────────────────────────┐   │
│  │ ChatComponent│   │ DynamicRenderer                       │   │
│  │  └ FormsModule│  │  profile_summary → ProfileComponent   │   │
│  │  └ HttpClient │  │  simulation_chart → SimulationComponent│  │
│  │  └ finalize() │  │  portfolio_view → PortfolioComponent  │   │
│  └──────────────┘  │  risk_dashboard → RiskComponent       │   │
│       │ POST        │  explanation_panel → ExplanationComponent│  │
│       │ WebSocket   │  TracePanelComponent (always shown)   │   │
└───────┼─────────────┴───────────────────────────────────────┘───┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Express Backend (port 3000)                            │
│                                                                 │
│  ChatRoute → LangGraph pipeline:                                │
│    node_planner → node_profile → node_simulation                │
│                                        ↓                        │
│                          node_portfolio → node_risk             │
│                                               ↓                 │
│                                    node_explanation → END       │
│                                                                 │
│  Each node:                                                     │
│    PromptTemplate → Ollama (llama3.2) → JsonOutputParser        │
│                                                                 │
│  Memory:                                                        │
│    Redis ──────── session JSON (structured state)               │
│    Markdown ───── data/sessions/*.md (human-readable)           │
│    ChromaDB ───── vector embeddings (RAG retrieval)             │
│                                                                 │
│  Events:                                                        │
│    AppEventEmitter → WebSocket → Angular (live updates)         │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Ollama :11434   │  │  Redis :6379     │  │  ChromaDB :8000  │
│  llama3.2 model  │  │  Session data    │  │  Vector embeddings│
│  Generates LLM   │  │  Conversation    │  │  RAG search      │
│  responses       │  │  history         │  │  Semantic memory │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Verifying each component manually

### Test backend health
```bash
curl http://localhost:3000/api/health | python3 -m json.tool
```
Expected:
```json
{
  "status": "ok",
  "services": {
    "ollama":   { "status": "ok",       "detail": "llama3.2:latest" },
    "redis":    { "status": "ok",       "detail": "connected" },
    "chromadb": { "status": "ok",       "detail": "connected" }
  }
}
```

### Test Ollama directly
```bash
curl http://localhost:11434/api/generate \
  -d '{"model":"llama3.2","prompt":"Say hello in one word","stream":false}'
```

### Test a chat message
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Can I retire at 55? I am 42, earn $120k, have $380k savings"}' \
  | python3 -m json.tool
```

### Inspect a Redis session
```bash
redis-cli keys "session:*"
redis-cli get "session:<id>" | python3 -m json.tool
```

### View generated markdown files
```bash
ls backend/data/sessions/
cat backend/data/sessions/<session-id>.md
```

### Check ChromaDB collection
```bash
curl http://localhost:8000/api/v1/collections | python3 -m json.tool
```

---

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| LLM calls hang | Ollama not running | `ollama serve` |
| `null` profile/simulation | LLM returned bad JSON | Check Ollama model is pulled: `ollama list` |
| Empty UI components | Planner returned no `ui[]` | Ask a more specific financial question |
| No trace items | Pipeline errored silently | Check backend terminal for `[Error]` lines |
| Redis `PONG` but no session | Wrong host/port in `.env` | Check `REDIS_HOST` and `REDIS_PORT` |
