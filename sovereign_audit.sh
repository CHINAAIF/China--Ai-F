#!/bin/bash
set -e

TOTAL_BACKUP="audit_backup_$(date +%Y%m%d_%H%M%S)"
REVIEW_DIR="audit_pending_review_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$TOTAL_BACKUP" "$REVIEW_DIR"
echo "[*] نسخ احتياطي في: $TOTAL_BACKUP"
echo "[*] المخرجات المقترحة (للمراجعة فقط) في: $REVIEW_DIR"

CORE_PROMPT="You are a senior security engineer reviewing production code for a real company.
TASK: Audit the following file for real defects only.
1. Identify concrete vulnerabilities: OWASP Top 10, race conditions, type confusion, SQL injection risk, unhandled promise rejections, missing input validation.
2. Identify concrete code-quality issues: unclear naming, dead code, missing error handling.
3. For each issue found: explain WHY it is a real risk, then propose the exact fixed code for that section only.
4. Do NOT rewrite working, safe code 'for style'. Only touch what is genuinely broken or risky.
5. Output format: numbered findings, each with file location, risk explanation, minimal diff-style fix.
Do not claim a finding unless you can point to the exact line and explain the concrete exploit/failure scenario."

PROCESSED=0
FAILED=()

while IFS= read -r file; do
    echo "==================================================="
    echo "[فحص $((PROCESSED+1))] $file"
    cp "$file" "$TOTAL_BACKUP/$(basename "$file").original" 2>/dev/null || true

    OUTPUT_FILE="$REVIEW_DIR/$(echo "$file" | sed 's#^\./##; s#/#__#g').findings.md"
    if tgpt "$CORE_PROMPT

TARGET FILE PATH: $file
TARGET CODE:
$(cat "$file")" < /dev/null > "$OUTPUT_FILE" 2>>"$REVIEW_DIR/_errors.log"; then
        echo "[✓] محفوظ: $OUTPUT_FILE"
        PROCESSED=$((PROCESSED+1))
    else
        echo "[❌] فشل: $file — راجع $REVIEW_DIR/_errors.log"
        FAILED+=("$file")
    fi
done < <(find . -type f -name "*.js" ! -path "*/node_modules/*" ! -path "*/audit_backup_*/*" ! -path "*/audit_pending_review_*/*")

echo "==================================================="
echo "[تم] عولج فعليًا: $PROCESSED ملفًا"
if [ ${#FAILED[@]} -gt 0 ]; then
    echo "[⚠️] فشل: ${#FAILED[@]} ملفًا:"
    printf '  - %s\n' "${FAILED[@]}"
fi
echo "كل النتائج اقتراحات للمراجعة البشرية فقط — لا دفع git، لا تعديل ملفات حقيقية."
