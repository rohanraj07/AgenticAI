# 🚀 MASTER PROMPT: END-TO-END AGENTIC REACTIVE SYSTEM (A2A + A2UI + RAG + LANGCHAIN)

## 🎯 OBJECTIVE

Build a **production-grade POC** of an intelligent financial planning system using:

* Node.js (backend)
* Angular (frontend, A2UI dynamic rendering)
* LLM (open-source compatible)
* Redis + Markdown (hybrid memory)
* Vector DB (for RAG)
* LangChain (LLM orchestration)
* LangGraph (agent flow control)
* LangSmith (observability)

The system must be:

* Agent-driven (A2A)
* UI-driven by planner (A2UI)
* Reactive (event-driven updates)
* Context-aware (RAG + memory)
* Fully runnable on a single machine

---

# 🧠 CORE ARCHITECTURE

## 1. AGENT ECOSYSTEM (DDD-STYLE BOUNDARIES)

Each agent must have:

* Clear responsibility
* Input/output schema
* Memory scope
* Prompt template
* LangChain wrapper

### Agents:

1. planner_agent (orchestrator)
2. profile_agent (user data extraction)
3. simulation_agent (financial projections)
4. portfolio_agent (investment allocation)
5. risk_agent (risk scoring)
6. explanation_agent (human-readable reasoning)

---

## 2. LANGCHAIN + LANGGRAPH

### LangChain:

* Wrap each agent as a **Chain**
* Use PromptTemplate + LLM + Memory

### LangGraph:

* Define DAG:

```
planner → profile → simulation → portfolio → explanation
                         ↓
                      risk_agent
```

* Conditional edges:

  * If user asks "risk" → trigger risk_agent
  * If user modifies input → re-trigger downstream nodes

---

## 3. RAG (VECTOR DATABASE)

### Use:

* ChromaDB or FAISS (local)

### Store:

* Markdown memory
* Agent outputs
* User queries

### Flow:

1. Convert memory → embeddings
2. Store in vector DB
3. On each query:

   * Retrieve top-K relevant docs
   * Inject into agent prompts

---

## 4. HYBRID MEMORY

### Redis:

* Structured JSON
* Real-time state

### Markdown:

* Human-readable context
* Used for LLM reasoning

### Vector DB:

* Long-term semantic memory

---

## 5. REACTIVE EVENT SYSTEM

Use Node.js EventEmitter:

Events:

* PROFILE_UPDATED
* SIMULATION_UPDATED
* PORTFOLIO_UPDATED

Each event triggers dependent agents automatically.

---

## 6. BACKEND API

POST `/chat`

Input:

```
{
  "sessionId": "123",
  "message": "Can I retire at 55?"
}
```

Flow:

1. planner_agent decides:

   * actions
   * UI components
2. Execute agents via LangGraph
3. Retrieve RAG context
4. Return:

```
{
  "message": "Yes, based on your savings...",
  "ui": [...],
  "data": {...},
  "trace": [...]
}
```

---

## 7. FRONTEND (ANGULAR + A2UI)

### Components:

1. ChatComponent
2. DynamicRendererComponent
3. ProfileComponent
4. SimulationComponent
5. PortfolioComponent
6. RiskComponent
7. ExplanationComponent
8. TracePanelComponent

### Behavior:

* UI rendered dynamically from backend response
* Use RxJS/WebSocket for real-time updates

---

## 8. A2UI FORMAT

Backend returns:

```
{
  "ui": [
    { "type": "profile_summary" },
    { "type": "simulation_chart" },
    { "type": "portfolio_view" },
    { "type": "risk_dashboard" },
    { "type": "explanation_panel" }
  ]
}
```

Frontend maps → Angular components

---

## 9. LANGSMITH (OBSERVABILITY)

* Log:

  * prompts
  * responses
  * agent transitions
  * memory reads/writes

* Show in TracePanel UI:

  * execution timeline
  * latency
  * decision path

---

## 10. VECTOR DB INTEGRATION

Example:

```js
const embedding = await embeddings.create(markdown);
await vectorDB.add({
  id,
  values: embedding,
  metadata
});

const results = await vectorDB.search(queryEmbedding, { topK: 5 });
```

Inject results into prompts.

---

## 11. FILE STRUCTURE

```
/backend
  /agents
  /langchain
  /langgraph
  /memory
  /vector
  /events
  /routes

/frontend
  /components
  /services
  /pages

/docs
  README.md
  ARCHITECTURE.md
  AGENTS.md
  RUNBOOK.md
```

---

## 12. TEST SCENARIOS

1. "Can I retire at 55?"
2. "Show risk"
3. "Make it aggressive"
4. "Increase savings to 700k"

Expect:

* Reactive updates
* UI refresh
* Trace logs
* RAG-enhanced responses

---

## 13. REQUIREMENTS

* Must run locally on single machine
* Use open-source LLM (Ollama / local model)
* Include setup scripts
* Include `.env` config
* Include sample data
* Include WebSocket streaming
* Include documentation

---

## 🚨 CRITICAL INSTRUCTIONS

* Generate COMPLETE working code
* Do NOT break into pieces
* Include backend + frontend + docs
* Ensure:

  * A2A orchestration
  * A2UI rendering
  * LangChain usage
  * LangGraph flow
  * LangSmith logging
  * RAG (vector DB)
  * Reactive event system

---

## ✅ EXPECTED OUTCOME

* Chat-driven UI
* Planner decides UI dynamically
* Agents communicate via A2A
* UI updates reactively
* Memory persists across sessions
* Vector DB enables contextual intelligence
* Full observability via trace panel

---

## FINAL INSTRUCTION TO CLAUDE

“Generate the full working system in one response. Include all files, code, configuration, and documentation. Ensure everything runs locally and demonstrates A2A + A2UI + RAG + LangChain + LangGraph + LangSmith with reactive updates.”
