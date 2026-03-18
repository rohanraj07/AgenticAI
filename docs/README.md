# AI Financial Planner — POC

An end-to-end agentic financial planning system built with:

| Layer | Technology |
|-------|------------|
| LLM Orchestration | LangChain.js |
| Agent Flow | LangGraph |
| Observability | LangSmith |
| Backend | Node.js + Express + WebSocket |
| Frontend | Angular 17 (standalone components) |
| Structured Memory | Redis |
| Semantic Memory | ChromaDB (vector DB) |
| Human-readable Memory | Markdown files |
| Local LLM | Ollama (llama3.2) |

---

## Quick Start

### 1. Prerequisites

```bash
# Node.js 20+
node --version

# Ollama — install from https://ollama.ai
ollama pull llama3.2

# Redis (via Docker is easiest)
docker run -d -p 6379:6379 redis:7

# ChromaDB
pip install chromadb
chroma run --port 8000
```

### 2. Backend

```bash
cd backend
npm install
cp .env .env.local    # edit LANGSMITH_API_KEY if you have one
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm start
# Opens at http://localhost:4200
```

---

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Agent Reference

See [AGENTS.md](AGENTS.md).

## Runbook

See [RUNBOOK.md](RUNBOOK.md).
