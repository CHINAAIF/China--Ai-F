import fs from 'fs';
import process from 'process';

console.log('🤖 [المساعد الداخلي]: جاري فحص وتأمين متغيرات البيئة في السحاب...');

// إذا كان التطبيق يعمل في السحاب ولم يجد المتغير، سيقرأه من الملف المحلي بأمان
if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    const dbUrlMatch = envContent.match(/DATABASE_URL\s*=\s*['\"]?([^'\n\"]+)['\"]?/);
    if (dbUrlMatch && dbUrlMatch[1]) {
        process.env.DATABASE_URL = dbUrlMatch[1];
        console.log('✅ [المساعد الداخلي]: تم تشكيل وجلب رابط قاعدة البيانات بنجاح.');
    }
}

// استدعاء النواة المستقرة والجاهزة للعمل
import './index.js';
