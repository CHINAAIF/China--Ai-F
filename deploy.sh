#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy.sh — نشر آمن إلى GitHub + Railway
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'; BOLD='\033[1m'

log()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}   🚀 نشر آمن — GitHub + Railway${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}\n"

# ============================================================
# 1) فحص الأدوات المطلوبة
# ============================================================
log "فحص الأدوات المطلوبة..."
MISSING=()
for tool in git node npm curl; do
  command -v "$tool" &>/dev/null || MISSING+=("$tool")
done
[ ${#MISSING[@]} -eq 0 ] || fail "أدوات مفقودة: ${MISSING[*]} — ثبّتها أولاً"
ok "كل الأدوات موجودة"

# ============================================================
# 2) فحص الملفات الحساسة — لا تُرفع أبداً
# ============================================================
log "فحص .gitignore والملفات الحساسة..."

REQUIRED_IGNORES=(".env" "*.pem" "*.key" "*.cert" "node_modules/" "fix_*.js" "fix_*.txt")
GITIGNORE=".gitignore"
UPDATED=false

for item in "${REQUIRED_IGNORES[@]}"; do
  if ! grep -qxF "$item" "$GITIGNORE" 2>/dev/null; then
    echo "$item" >> "$GITIGNORE"
    warn "أُضيف إلى .gitignore: $item"
    UPDATED=true
  fi
done
$UPDATED && ok ".gitignore محدّث" || ok ".gitignore سليم بالفعل"

# فحص أمان: هل .env موجود في staged files؟
if git diff --cached --name-only 2>/dev/null | grep -q "^\.env"; then
  fail ".env موجود في staged files — خطر تسريب! شغّل: git rm --cached .env"
fi

# فحص مفاتيح مكشوفة في الكود
log "فحص مفاتيح مكشوفة في الكود..."
LEAK_PATTERNS='(ENCRYPTION_KEY|SECRET|PASSWORD|API_KEY|TOKEN)\s*=\s*["\x27][^"\x27$][^"\x27]{6,}["\x27]'
if git diff --cached -U0 2>/dev/null | grep -qiP "$LEAK_PATTERNS" 2>/dev/null || \
   grep -riP "$LEAK_PATTERNS" --include="*.js" --include="*.ts" --include="*.json" \
     --exclude-dir=node_modules --exclude-dir=".git" . 2>/dev/null | \
     grep -v "\.env\|process\.env\|getEncryptionKey\|WEAK_KEYS"; then
  fail "كلمة سر أو مفتاح مكشوف في الكود — راجع الملفات أعلاه قبل المتابعة"
fi
ok "لا مفاتيح مكشوفة في الكود"

# ============================================================
# 3) فحص سلامة الكود
# ============================================================
log "فحص سلامة الكود (syntax check)..."
find . -name "*.js" -not -path "./node_modules/*" -not -path "./.git/*" | while read -r f; do
  node --check "$f" 2>/dev/null || fail "خطأ syntax في: $f"
done
ok "Syntax سليم لكل ملفات JS"

# ============================================================
# 4) Git — commit ورفع
# ============================================================
log "تجهيز Git commit..."

if ! git rev-parse --git-dir &>/dev/null; then
  fail "هذا المجلد ليس Git repo — شغّل: git init"
fi

# فحص remote
if ! git remote get-url origin &>/dev/null; then
  echo -e "${YELLOW}أدخل رابط GitHub repo (مثال: https://github.com/user/repo.git):${NC}"
  read -r REMOTE_URL
  git remote add origin "$REMOTE_URL"
  ok "Remote origin أُضيف: $REMOTE_URL"
fi

REMOTE_URL=$(git remote get-url origin)
ok "Remote: $REMOTE_URL"

# الفرع الحالي
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
log "الفرع الحالي: $BRANCH"

# Stage الكل ما عدا المستثنيات
git add -A

STAGED=$(git diff --cached --name-only 2>/dev/null)
if [ -z "$STAGED" ]; then
  warn "لا يوجد تغييرات جديدة للـcommit — تحقق إذا كنت تريد المتابعة"
else
  echo -e "\n${BOLD}الملفات المراد رفعها:${NC}"
  echo "$STAGED"
  echo ""
fi

# رسالة commit
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
COMMIT_MSG="🔒 security: تصحيح ثغرات + طبقة حماية موحّدة [$TIMESTAMP]

- إضافة lib/security-core.js (تشفير + SSL + redaction)
- سد ثغرة ENCRYPTION_KEY الافتراضي
- سد ثغرة SSL rejectUnauthorized:false
- إصلاح regex base64 redaction
- سكريبت تصحيح INSERT تصحيحي لـevent_log"

echo -e "${BOLD}رسالة الـcommit:${NC}\n$COMMIT_MSG\n"

if [ -n "$STAGED" ]; then
  git commit -m "$COMMIT_MSG"
  ok "Commit تم"
fi

log "رفع إلى GitHub ($BRANCH)..."
git push origin "$BRANCH" --follow-tags && ok "✅ GitHub: تم الرفع بنجاح" || \
  fail "فشل الرفع — تحقق من الصلاحيات أو الاتصال"

# ============================================================
# 5) Railway — نشر
# ============================================================
log "فحص Railway CLI..."

if ! command -v railway &>/dev/null; then
  warn "Railway CLI غير مثبّت — جارٍ التثبيت..."
  npm install -g @railway/cli 2>/dev/null || \
  curl -fsSL https://railway.app/install.sh | sh 2>/dev/null || \
  fail "فشل تثبيت Railway CLI — ثبّته يدوياً: npm i -g @railway/cli"
fi
ok "Railway CLI موجود"

# فحص تسجيل الدخول
if ! railway whoami &>/dev/null; then
  warn "غير مسجّل دخول لـRailway..."
  railway login || fail "فشل تسجيل الدخول لـRailway"
fi
ok "Railway: مسجّل دخول كـ$(railway whoami 2>/dev/null)"

# فحص ربط المشروع
if [ ! -f ".railway/config.json" ] && ! railway status &>/dev/null 2>&1; then
  warn "المشروع غير مربوط بـRailway — جارٍ الربط..."
  railway link || fail "فشل ربط المشروع — تأكد من وجود مشروع Railway جاهز"
fi

log "نشر إلى Railway..."
railway up --detach && ok "✅ Railway: النشر بدأ بنجاح" || \
  fail "فشل نشر Railway — شغّل: railway logs"

# ============================================================
# 6) التحقق من متغيّرات البيئة على Railway
# ============================================================
log "فحص متغيّرات البيئة على Railway..."

REQUIRED_VARS=("ENCRYPTION_KEY" "DATABASE_URL")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
  if ! railway variables 2>/dev/null | grep -q "^$var"; then
    MISSING_VARS+=("$var")
  fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  warn "متغيّرات ناقصة في Railway: ${MISSING_VARS[*]}"
  warn "أضفها عبر: railway variables set ENCRYPTION_KEY=xxxx"
  warn "أو من لوحة Railway: Settings → Variables"
else
  ok "كل المتغيّرات المطلوبة موجودة في Railway"
fi

# ============================================================
# 7) ملخص نهائي
# ============================================================
echo -e "\n${BOLD}═══════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}   🎉 النشر اكتمل بنجاح${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "📦 GitHub : $REMOTE_URL"
echo -e "🚂 Railway : $(railway status 2>/dev/null | grep -oP 'https://\S+' | head -1 || echo 'شغّل: railway open')"
echo -e "📋 Logs   : railway logs --tail"
echo -e "${BOLD}═══════════════════════════════════════${NC}\n"

