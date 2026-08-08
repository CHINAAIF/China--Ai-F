#!/bin/bash
set -e

echo -e "\e[1;34m[*] تصفية البيئة وتحديث مستودعات تيرمكس...\e[0m"
pkg update -y && pkg install gh coreutils -y

echo -e "\e[1;34m[*] بدء عملية التوثيق الذكية مع جيت هاب...\e[0m"
echo -e "\e[1;33m[!] تنبيه: السكريبت سيفتح لك خيارات التوثيق تلقائياً وبأعلى معايير الأمان.\e[0m"

# تشغيل التوثيق القياسي لـ GitHub CLI
gh auth login --web -h github.com -p https

echo -e "\e[1;32m[*] تفعيل وحقن مساعد الذكاء الاصطناعي (gh-copilot)...\e[0m"
gh extension install github/gh-copilot --force || true

echo -e "\e[1;32m[*] حقن الاختصار البرمجي السيادي (Alias)...\e[0m"
sed -i '/alias copilot=/d' ~/.bashrc
echo "alias copilot='gh copilot suggest'" >> ~/.bashrc

echo -e "\e[1;32m[✓] اكتملت العملية بنجاح! يرجى كتابة: source ~/.bashrc لتفعيل الأمر.\e[0m"
