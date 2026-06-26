#!/bin/bash
echo "[STARTUP] Launching TRUNKIA Dual Runtime (Node.js + Python)..."
npx concurrently --names "PYTHON,NODE" --prefix-colors "blue,green" \
  "python3 -m uvicorn sidecar.main:app --host 127.0.0.1 --port 8001" \
  "node index.js"
