#!/bin/sh
echo "[STARTUP] Starting Python Sidecar in background..."
python3 -m uvicorn sidecar.main:app --host 127.0.0.1 --port 8001 &

echo "[STARTUP] Starting Node.js Gateway..."
exec node index.js
