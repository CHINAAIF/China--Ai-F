#!/bin/bash
echo "=== 1. ملفات بأسماء عربية أو غير قياسية ==="
find . -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.json" \) 2>/dev/null | grep -v node_modules | grep -v "\.git/" | grep -P '[\x{0600}-\x{06FF}]'

echo -e "\n=== 2. مجلدات بأسماء عربية ==="
find . -type d 2>/dev/null | grep -v node_modules | grep -v "\.git" | grep -P '[\x{0600}-\x{06FF}]'

echo -e "\n=== 3. أسماء ملفات غير متسقة (kebab-case مقابل snake_case) ==="
find agents/ -name "*.js" 2>/dev/null | grep -E '_[a-z]' | wc -l
echo "^ عدد الملفات بنمط snake_case (يفترض kebab-case في هذا المشروع)"
find agents/ -name "*.js" 2>/dev/null | grep -E '\-[a-z]' | wc -l
echo "^ عدد الملفات بنمط kebab-case"

echo -e "\n=== 4. ملفات مكررة الاسم في مجلدات مختلفة ==="
find . -type f -name "*.js" 2>/dev/null | grep -v node_modules | xargs -I{} basename {} | sort | uniq -d

echo -e "\n=== 5. حجم المشروع الكلي (استبعاد node_modules) ==="
find . -type f \( -name "*.js" -o -name "*.mjs" \) 2>/dev/null | grep -v node_modules | grep -v "\.git/" | wc -l
echo "^ عدد ملفات JS/MJS الكلي"
