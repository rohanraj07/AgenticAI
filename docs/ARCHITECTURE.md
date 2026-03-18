# Architecture

## System Diagram

```
 User (Browser)
      │  HTTP POST /api/chat
      │  WebSocket (subscribe + live events)
      ▼
 ┌─────────────────────────────────────────────────┐
 │                  Node.js Backend                │
 │                                                 │
 │  ChatRoute ──► LangGraph Pipeline               │
 │                 │                               │
 │                 ├─► PlannerAgent                │
 │                 ├─► ProfileAgent                │
 │                 ├─► SimulationAgent             │
 │                 ├─► PortfolioAgent              │
 │                 ├─► RiskAgent                   │
 │                 └─► ExplanationAgent            │
 │                                                 │
 │  Each agent uses LangChain chains:              │
 │    PromptTemplate → Ollama LLM → JsonParser     │
 │                                                 │
 │  Memory:                                        │
 │    Redis  ── structured JSON sessions           │
 │    Markdown ── human-readable snapshots         │
 │    ChromaDB ── embeddings for RAG               │
 │                                                 │
 │  EventEmitter → WebSocket broadcast             │
 └─────────────────────────────────────────────────┘
      │  JSON response + live WS events
      ▼
 Angular Frontend
   AppComponent
     ├── ChatComponent          (left panel)
     └── DynamicRendererComponent (right panel)
           ├── ProfileComponent
           ├── SimulationComponent
           ├── PortfolioComponent
           ├── RiskComponent
           ├── ExplanationComponent
           └── TracePanelComponent
```

## LangGraph DAG

```
planner ──► profile ──► simulation ──► portfolio ──► explanation
                              │
                              └──► risk ──────────────► explanation
```

Conditional edges: only agents listed in the planner's `agents` array are executed.

## Hybrid Memory

| Store | Type | Purpose |
|-------|------|---------|
| Redis | JSON | Real-time session state (profile, simulation results, etc.) |
| Markdown | Plain text | Human-readable snapshots for LLM context |
| ChromaDB | Vector embeddings | Semantic retrieval (RAG) across sessions |

## A2UI Protocol

The backend returns a `ui` array that tells the frontend which components to render:

```json
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

The `DynamicRendererComponent` maps each `type` → Angular component at runtime.

## Reactive Event Flow

```
Agent completes
   → AppEventEmitter.emit(EVENT_NAME, payload)
      → WS route listener
         → broadcast to all subscribed WebSocket clients
            → Angular WebSocketService Observable
               → Component updates reactively
```
