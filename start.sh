#!/bin/sh
echo "[STARTUP] Initializing Python Sidecar..."
python3 -m uvicorn sidecar.main:app --host 127.0.0.1 --port 8001 &
SIDECAR_PID=$!

# Wait for Sidecar to be ready
for i in $(seq 1 10); do
  if curl -s http://127.0.0.1:8001/health > /dev/null; then
    echo "[STARTUP] Python Sidecar is UP and healthy."
    break
  fi
  echo "[STARTUP] Waiting for Sidecar..."
  sleep 1
done

echo "[STARTUP] Starting Node.js Gateway..."
node index.js &
NODE_PID=$!

# Wait for any process to exit
wait -n $SIDECAR_PID $NODE_PID
EXIT_CODE=$?

# Exit with the code of the first process to exit
exit $EXIT_CODE
