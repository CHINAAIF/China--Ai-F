#!/bin/bash
echo "أدخل كلمة المرور الجديدة من Neon:"
read -s NEW_PASS

FILE="$HOME/downloads/China--Ai-F/.env"
sed -i "s|postgresql://neondb_owner:[^@]*@|postgresql://neondb_owner:${NEW_PASS}@|" "$FILE"
echo "✅ تم التحديث"
grep DATABASE_URL "$FILE" | sed 's/:.*@/:***@/'
