#!/bin/bash

# 1. إنشاء ملف الحوكمة والتحقق (الدرع الأمني)
cat > agents/SecurityGovernance.js << 'SEC'
export const Governance = {
  async validate(command) {
    const dangerousPatterns = [/eval\(/, /rm -rf/, /process\.exit/, /fs\.unlink/];
    const isDangerous = dangerousPatterns.some(pattern => pattern.test(command));
    
    if (isDangerous) return { safe: false, reason: "محاولة تنفيذ أمر خطير على النظام" };
    return { safe: true };
  }
};
SEC

# 2. إنشاء البوت المحصن
cat > agents/TelegramAgent.js << 'BOT'
import { Telegraf } from 'telegraf';
import { Governance } from './SecurityGovernance.js';

const bot = new Telegraf(procat > .env << 'EOF'
TELEGRAM_TOKEN=8302364376:AAG99lxEyt3lwq_NIN7o8kK7l0tBtlIKmOA
ADMIN_TELEGRAM_ID=6101711192
