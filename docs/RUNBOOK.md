# Runbook

## Local Setup Checklist

- [ ] Node.js 20+ installed
- [ ] Ollama installed and `llama3.2` model pulled
- [ ] Redis running on port 6379
- [ ] ChromaDB running on port 8000
- [ ] Backend running on port 3000
- [ ] Frontend running on port 4200

---

## Starting Services

### Ollama

```bash
ollama serve          # starts API on :11434
ollama pull llama3.2  # download model (~2 GB)
```

### Redis

```bash
docker run -d --name redis -p 6379:6379 redis:7
# or if installed locally:
redis-server
```

### ChromaDB

```bash
pip install chromadb
chroma run --host 0.0.0.0 --port 8000
```

### Backend

```bash
cd backend
npm install
npm run dev
```

Expected output:
```
[Redis] Connected
[VectorDB] Initialised
[Server] HTTP + WebSocket listening on port 3000
```

### Frontend

```bash
cd frontend
npm install
npm start
# → http://localhost:4200
```

---

## Test Scenarios

### 1. Retirement feasibility

```
User: "Can I retire at 55?"
Expected: profile_summary + simulation_chart + explanation_panel
```

### 2. Risk check

```
User: "Show my risk score"
Expected: risk_dashboard + explanation_panel
```

### 3. Aggressive portfolio

```
User: "Make it aggressive"
Expected: portfolio_view + risk_dashboard + explanation_panel
```

### 4. Savings update

```
User: "Increase savings to 700k"
Expected: simulation_chart + portfolio_view + explanation_panel (reactive update)
```

---

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|-------------|-----|
| `ECONNREFUSED 11434` | Ollama not running | `ollama serve` |
| `ECONNREFUSED 6379` | Redis not running | `docker start redis` |
| `ECONNREFUSED 8000` | ChromaDB not running | `chroma run --port 8000` |
| Empty LLM response | Model not pulled | `ollama pull llama3.2` |
| `500 Internal Server Error` | Check backend logs | `npm run dev` shows stack trace |

---

## LangSmith Observability

1. Create account at [smith.langchain.com](https://smith.langchain.com)
2. Create API key
3. Set in `backend/.env`:
   ```
   LANGCHAIN_API_KEY=lsv2_...
   LANGCHAIN_PROJECT=financial-planner-poc
   ```
4. All agent calls are automatically traced

---

## Stopping All Services

```bash
docker stop redis
# Kill Node.js: Ctrl+C in backend terminal
# Kill Angular: Ctrl+C in frontend terminal
# Kill Ollama: Ctrl+C in ollama terminal
# Kill ChromaDB: Ctrl+C in chroma terminal
```
