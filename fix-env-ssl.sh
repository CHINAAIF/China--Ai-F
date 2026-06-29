#!/bin/bash
FILE="$HOME/downloads/China--Ai-F/.env"
sed -i 's/?sslmode=verify-full/?sslmode=require/g' "$FILE"
echo "✅ Done"
grep DATABASE_URL "$FILE"
