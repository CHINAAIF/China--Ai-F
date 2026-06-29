#!/bin/bash
# سكريبت لربط الجسر تلقائياً بملف index.js
if ! grep -q "security_bridge" index.js; then
  echo "Injecting security bridge into index.js..."
  # إضافة سطر الاستيراد في بداية الملف
  sed -i '1i import { secureOutput } from "./security_bridge.js";' index.js
  echo "Injection successful."
else
  echo "Security bridge already injected."
fi
