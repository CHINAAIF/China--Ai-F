#!/bin/bash
cd ~/downloads/China--Ai-F
while true; do
  if ! curl -s --max-time 3 http://localhost:5000/health > /dev/null 2>&1; then
    pkill -f "node index.js" 2>/dev/null
    sleep 2
    node index.js >> /dev/null 2>&1 &
    sleep 8
  fi
  sleep 20
done
