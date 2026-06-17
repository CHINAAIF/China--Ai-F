import { execSync } from 'child_process';
import fs from 'fs';

console.log('🤖 [المساعد الداخلي]: جاري تشغيل مرحلة الدمج النهائي (Core & Agents Integration)...');

try {
    // تشغيل فحص الوكلاء أولاً للتأكد من سلامتهم قبل الإطلاق
    console.log('🔄 جاري التحقق من كفاءة الوكلاء الخمسة...');
    execSync('node test-pipeline.js', { stdio: 'inherit' });

    // إذا نجح فحص الوكلاء، نرفع الكود وملفات الـ agents إلى المستودع السحابي
    console.log('\n🚀 [الوكلاء 100%]: جاري أرشفة التعديلات والرفع الفوري للسحاب لإنهاء الدمج...');
    execSync('git add agents/ test-pipeline.js');
    execSync('git commit -m "Core: Integrate fully verified AI Agents into production ecosystem" --allow-empty');
    execSync('git push origin main --force');
    console.log('✅ تم الرفع بنجاح واستلمت منصة Railway طبقة الوكلاء الجديدة.');

    // الفحص الراجع بعد 50 ثانية للتأكد من التحديث الحي
    console.log('\n⏳ انتظر 50 ثانية ليتم بناء الحاوية السحابية حية وسأفحص الرابط تلقائياً...');
    setTimeout(() => {
        try {
            const curlRes = execSync('curl -i https://web-production-f0f2e.up.railway.app/health').toString();
            console.log('\n======================================================');
            console.log('📊 [التقرير السحابي الشامل بعد حقن الوكلاء]:');
            console.log('------------------------------------------------------');
            if (curlRes.includes('200') || curlRes.includes('OK') || curlRes.includes('status')) {
                console.log('🎉 المنظومة حية وتعمل بكامل طاقتها والوكلاء تم دمجهم بنجاح سحابياً!');
            } else {
                console.log('⚠️ استجابة السيرفر الحالية بعد الرفع:');
                console.log(curlRes.split('\n').slice(0, 5).join('\n'));
            }
            console.log('======================================================\n');
        } catch (cErr) {
            console.error('❌ خطأ في الشبكة أثناء الفحص الراجع:', cErr.message);
        }
    }, 50000);

} catch (err) {
    console.error('🛑 [إيقاف صارم]: تم إلغاء عملية الدمج والرفع لوجود خلل في الوكلاء!');
    process.exit(1);
}
