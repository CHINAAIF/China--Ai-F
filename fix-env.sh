#!/bin/bash
echo "أدخل كلمة المرور الجديدة من Neon:"
read -s NEW_PASS

FILE="$HOME/downloads/China--Ai-F/.env"

# احذف سطر DATABASE_URL القديم كاملاً
sed -i '/^DATABASE_URL/d' "$FILE"

# أضف السطر الجديد نظيفاً
echo "DATABASE_URL=postgresql://neondb_owner:${NEW_PASS}@ep-floral-sun-aqglj3p1-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require" >> "$FILE"

echo "✅ تم"
grep DATABASE_URL "$FILE" | sed 's/npg_[^@]*/***/'
