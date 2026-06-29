#!/bin/bash
FILE="$HOME/downloads/China--Ai-F/.env"

# احذف كل أسطر DATABASE_URL
sed -i '/DATABASE_URL/d' "$FILE"

echo "أدخل الـ URL كاملاً من Neon (يبدأ بـ postgresql://):"
read -r FULL_URL

echo "DATABASE_URL=${FULL_URL}" >> "$FILE"

echo "✅ تم"
grep DATABASE_URL "$FILE" | sed 's/npg_[^@]*/***/'
