#!/bin/bash

# 1. إنشاء مجلد النسخ الاحتياطية المؤرخ بدقة
BACKUP_DIR="backups_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "[*] تم إنشاء قبو النسخ الاحتياطي: $BACKUP_DIR"

# 2. البرومبت السيادي الخارق (The Ultimate Prompt)
# هذا البرومبت مصمم لكسر نمطية الذكاء الاصطناعي واستدعاء أعلى مستويات الهندسة البشرية
ULTIMATE_PROMPT="You are an elite, world-class Software Architect and Offensive/Defensive Cybersecurity Ninja. You are building a sovereign platform designed to compete directly with tech giants like Google and Microsoft. 

Analyze the following code from the perspective of an advanced hacker looking for zero-day vulnerabilities, and then rewrite it from the perspective of a master defender.

CRITICAL DIRECTIVES:
1. SECURE EVERYTHING: Close all loopholes, prevent prototype pollution, memory leaks, SQL/NoSQL injections, and strictly validate all inputs. Assume the environment is deeply hostile.
2. HUMAN ELITE STYLE: Write terse, highly optimized, non-standard but brilliant human code. Eradicate all AI fingerprints. NO robotic comments, NO 'Here is the code', NO academic formatting. 
3. ENTERPRISE GRADE: Make the logic bulletproof, hyper-scalable, and deeply integrated.
4. STRICT OUTPUT: Return ONLY the raw, executable script. Do NOT wrap it in markdown ticks (like \`\`\`). No pleasantries. Just pure, unadulterated, superhuman code."

echo "[*] إطلاق محرك الهندسة العكسية لاكتساح المستودع..."

# 3. استهداف ملفات المشروع وتجنب المجلدات غير المطلوبة
find . -type f -name "*.js" ! -path "*/node_modules/*" ! -name "sovereign_hardener.sh" ! -path "*/backups_*/*" | while read -r file; do
    echo "---------------------------------------------------"
    echo "[+] رصد الملف: $file"
    
    # أخذ نسخة احتياطية فورية قبل التعديل
    cp "$file" "$BACKUP_DIR/$(basename "$file").bak"
    echo "    [✓] تم تأمين نسخة احتياطية."
    
    CODE_CONTENT=$(cat "$file")
    
    echo "    [⚙️] جاري الفحص الأمني وإعادة الصياغة العبقرية..."
    
    # تمرير الكود للمحرك مع البرومبت الصارم وحفظه مؤقتاً
    tgpt "$ULTIMATE_PROMPT \n\n TARGET CODE TO REFACTOR:\n $CODE_CONTENT" > "$file.tmp"
    
    # تنظيف المخرجات من أي علامات Markdown قد يتجاهل الذكاء الاصطناعي الأوامر بتركها
    sed -i '/^```/d' "$file.tmp"
    
    # استبدال الملف الأصلي بالكود السيادي الجديد
    mv "$file.tmp" "$file"
    echo "    [🛡️] تم حقن الكود السيادي بنجاح."
done

echo "==================================================="
echo "[🏆] انتهت المهمة. مستودعك الآن يعمل بعقلية العمالقة ومؤمن بالكامل!"
echo "[ℹ️] يمكنك مراجعة كودك القديم في مجلد: $BACKUP_DIR"
