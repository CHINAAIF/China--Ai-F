#!/bin/bash
set -e
cd ~/downloads/China--Ai-F

echo "=== حذف المجلدات الاحتياطية التاريخية ==="
rm -rf audit_backup_20260628_191208
rm -rf backups_20260628_184939
rm -rf security_backup_20260628_225437
rm -rf security_backup_20260628_225603
echo "✅ 4 مجلدات backup محذوفة"

echo ""
echo "=== حذف ملفات .backup الفردية ==="
rm -f index.js.phase1.backup
rm -f index.js.phase2.backup
rm -f index.js.phase3.backup
rm -f index.js.phase4.backup
rm -f index.js.phase5.backup
rm -f index.js.phase6.backup
rm -f index.js.pre-inference.backup
rm -f lib/inference.js.backup
rm -f lib/cognitive-optimizer.mjs.backup
rm -f package.json.bak
echo "✅ 10 ملفات .backup محذوفة"

echo ""
echo "=== حذف سكربتات fix-env المتكررة ==="
rm -f fix-env.sh
rm -f fix-env2.sh
rm -f fix-env-ssl.sh
echo "✅ 3 سكربتات fix-env محذوفة"

echo ""
echo "=== حذف ملفات phase غير المستخدَمة (تأكدنا: 0 استيراد) ==="
rm -f phase1-fix.mjs
rm -f phase1b-fix.mjs
rm -f phase2-advisor.mjs
rm -f phase2-complete-data.mjs
echo "✅ 4 ملفات phase محذوفة"

echo ""
echo "=== التحقق النهائي ==="
find . -type f \( -iname "*.backup" -o -iname "*.bak" -o -iname "*phase[0-9]*" -o -iname "*fix-env*" \) 2>/dev/null | grep -v node_modules | grep -v "\.git/"
echo "(إن كانت القائمة أعلاه فارغة = التنظيف نجح بالكامل)"
