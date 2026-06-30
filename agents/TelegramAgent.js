import { Telegraf } from 'telegraf';
import { Governance } from './SecurityGovernance.js';

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const ADMIN = process.env.ADMIN_TELEGRAM_ID;

// الترحيب التلقائي عند بدء التشغيل
bot.start((ctx) => {
  ctx.reply("مرحباً بك يا مدير النظام. 🛡️ نظام الحوكمة مفعل.\nماذا تريد أن نفعل اليوم؟\n\nأرسل أي أمر وسأقوم بفحصه أمنياً قبل التنفيذ.");
});

bot.use(async (ctx, next) => {
  if (ctx.from.id.toString() !== ADMIN) return;
  await next();
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // تجاهل الأوامر الافتراضية
  
  const cmd = ctx.message.text;
  const result = await Governance.validate(cmd);
  
  if (!result.safe) {
    return ctx.reply(`🚫 [حظر أمني]: ${result.reason}`);
  }

  ctx.reply(`🛡️ [النظام]: تم استلام طلبك: "${cmd}". هل تأذن بالتنفيذ؟\nأرسل "/نعم" للتأكيد.`);
  
  // حفظ الأمر مؤقتاً (ملاحظة: هذا التصميم يتطلب قاعدة بيانات لجعلها احترافية)
  global.pendingCommand = cmd;
});

bot.command('نعم', (ctx) => {
  if (global.pendingCommand) {
    ctx.reply(`✅ [تنفيذ]: تم إرسال "${global.pendingCommand}" إلى TaskQueueAgent.`);
    global.pendingCommand = null;
  } else {
    ctx.reply("⚠️ لا يوجد أمر معلق للتنفيذ.");
  }
});

bot.launch();
console.log("🚀 Telegram Agent is now fully interactive.");
