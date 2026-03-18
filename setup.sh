#!/usr/bin/env bash
# ── AI Financial Planner — Local Setup Script ─────────────────────────────────
set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       AI Financial Planner — Setup Script            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
echo "[1/6] Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
NODE_VER=$(node --version)
echo "      Node.js $NODE_VER — OK"

# ── Check Ollama ──────────────────────────────────────────────────────────────
echo "[2/6] Checking Ollama..."
if ! command -v ollama &>/dev/null; then
  echo "WARNING: Ollama not found. Install from https://ollama.ai"
  echo "         Then run: ollama pull llama3.2"
else
  echo "      Ollama — OK"
  echo "      Pulling llama3.2 model (this may take a few minutes)..."
  ollama pull llama3.2 || echo "WARNING: Could not pull llama3.2. Start Ollama first."
fi

# ── Start Redis (Docker) ──────────────────────────────────────────────────────
echo "[3/6] Starting Redis..."
if command -v docker &>/dev/null; then
  if docker ps --filter name=redis --filter status=running | grep -q redis; then
    echo "      Redis already running"
  else
    docker run -d --name redis-fp -p 6379:6379 redis:7-alpine && echo "      Redis started on :6379"
  fi
else
  echo "WARNING: Docker not found. Start Redis manually on port 6379"
fi

# ── Start ChromaDB ────────────────────────────────────────────────────────────
echo "[4/6] Checking ChromaDB..."
if command -v chroma &>/dev/null; then
  echo "      Starting ChromaDB in background on :8000..."
  nohup chroma run --host 0.0.0.0 --port 8000 &>/tmp/chroma.log &
  echo "      ChromaDB PID: $!"
elif command -v pip3 &>/dev/null; then
  echo "      Installing ChromaDB..."
  pip3 install chromadb --quiet
  nohup chroma run --host 0.0.0.0 --port 8000 &>/tmp/chroma.log &
else
  echo "WARNING: pip3 not found. Install ChromaDB manually: pip install chromadb"
fi

# ── Install backend dependencies ──────────────────────────────────────────────
echo "[5/6] Installing backend dependencies..."
cd backend && npm install --silent && cd ..
echo "      Backend dependencies — OK"

# ── Install frontend dependencies ────────────────────────────────────────────
echo "[6/6] Installing frontend dependencies..."
cd frontend && npm install --silent && cd ..
echo "      Frontend dependencies — OK"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Setup complete!                                     ║"
echo "║                                                      ║"
echo "║  Start backend:  cd backend && npm run dev           ║"
echo "║  Start frontend: cd frontend && npm start            ║"
echo "║  Frontend URL:   http://localhost:4200               ║"
echo "║                                                      ║"
echo "║  Edit backend/.env to add your LangSmith API key     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
