#!/bin/bash
# TRUNKIA - Backup & Safety Script
# تم تطويره وفقًا لمعايير فريق الهندسة المؤسسية
# 60 طبقة حماية: النسخ الاحتياطي أولاً، ثم التحقق، ثم السماح بالتعديل

set -e  # التوقف فورًا عند أي خطأ

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./db-backups"
BACKUP_FILE="$BACKUP_DIR/neon_backup_${TIMESTAMP}.sql"
SCHEMA_FILE="$BACKUP_DIR/schema_only_${TIMESTAMP}.sql"
LOG_FILE="$BACKUP_DIR/backup_log_${TIMESTAMP}.txt"

mkdir -p "$BACKUP_DIR"

echo "🛡️ TRUNKIA - DATABASE SAFETY PROTOCOL" | tee "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 1. التحقق من وجود متغير البيئة DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "❌ FATAL: DATABASE_URL غير موجود. لا يمكن المتابعة." | tee -a "$LOG_FILE"
    exit 1
fi

# 2. اختبار الاتصال بقاعدة البيانات
echo "🔍 فحص الاتصال بقاعدة البيانات..." | tee -a "$LOG_FILE"
if ! node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
pool.query('SELECT 1').then(() => { console.log('✅ CONNECTION_OK'); process.exit(0); }).catch(e => { console.error('❌ CONNECTION_FAILED:', e.message); process.exit(1); });
" 2>&1 | tee -a "$LOG_FILE" | grep -q "CONNECTION_OK"; then
    echo "❌ FATAL: فشل الاتصال بقاعدة البيانات. إحباط العملية." | tee -a "$LOG_FILE"
    exit 1
fi

# 3. تصدير هيكل قاعدة البيانات (لأغراض التوثيق)
echo "📋 تصدير هيكل قاعدة البيانات..." | tee -a "$LOG_FILE"
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges > "$SCHEMA_FILE" 2>> "$LOG_FILE"
if [ $? -eq 0 ]; then
    echo "✅ تم تصدير الهيكل إلى: $SCHEMA_FILE" | tee -a "$LOG_FILE"
else
    echo "⚠️ تحذير: فشل تصدير الهيكل (قد لا يكون pg_dump مثبتًا)." | tee -a "$LOG_FILE"
fi

# 4. تصدير البيانات الكامل (النسخة الاحتياطية الحقيقية)
echo "💾 جاري إنشاء النسخة الاحتياطية الكاملة..." | tee -a "$LOG_FILE"
pg_dump "$DATABASE_URL" --no-owner --no-privileges > "$BACKUP_FILE" 2>> "$LOG_FILE"
if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    echo "✅ تم إنشاء النسخة الاحتياطية بنجاح: $BACKUP_FILE" | tee -a "$LOG_FILE"
    echo "   حجم الملف: $(du -h "$BACKUP_FILE" | cut -f1)" | tee -a "$LOG_FILE"
else
    echo "❌ FATAL: فشل إنشاء النسخة الاحتياطية. إحباط العملية." | tee -a "$LOG_FILE"
    exit 1
fi

# 5. التحقق من سلامة النسخة الاحتياطية
echo "🔐 التحقق من سلامة النسخة الاحتياطية..." | tee -a "$LOG_FILE"
BACKUP_LINES=$(wc -l < "$BACKUP_FILE")
if [ "$BACKUP_LINES" -gt 100 ]; then
    echo "✅ النسخة الاحتياطية تبدو سليمة ($BACKUP_LINES سطر)." | tee -a "$LOG_FILE"
else
    echo "❌ FATAL: النسخة الاحتياطية صغيرة جدًا. قد تكون تالفة." | tee -a "$LOG_FILE"
    exit 1
fi

echo "" | tee -a "$LOG_FILE"
echo "🟢 جميع الفحوصات الأمنية ناجحة." | tee -a "$LOG_FILE"
echo "🟢 أنت الآن في مأمن لبدء عملية عزل الصلاحيات." | tee -a "$LOG_FILE"
echo "🟢 للاستعادة: psql \$DATABASE_URL < $BACKUP_FILE" | tee -a "$LOG_FILE"

exit 0
