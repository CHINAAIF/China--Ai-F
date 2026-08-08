import { Pool } from 'pg';

// إعداد الاتصال بقاعدة البيانات باستخدام المتغيرات البيئية المؤمنة
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

/**
 * دالة Middleware لفحص وحظر البوتات والزواحف الخبيثة
 * ممتثلة لمعايير الحصانة السيبرانية العسكرية
 */
export async function scraperGuard(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // 1. تحديد بصمات البوتات والزواحف المعروفة بـ 9 أنماط صارمة
  const botPatterns = /bot|crawler|spider|scrape|curl|wget|python|axios|headless/i;
  
  if (botPatterns.test(userAgent)) {
    const iocHash = Buffer.from(`${ip}-${userAgent}`).toString('base64');
    
    try {
      // 2. حقن فوري للبصمة الجنائية داخل جداول التهديدات الشاغرة في الـ DB
      await pool.query(
        `INSERT INTO threat.bot_logs (ip_address, user_agent, threat_level, ioc_hash) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (ioc_hash) DO UPDATE SET attack_count = threat.bot_logs.attack_count + 1`,
        [ip, userAgent, 'CRITICAL', iocHash]
      );
      
      // 3. تفعيل الـ Honeypot: رد وهمي مضلل (200 OK) بتكلفة صفرية دون استدعاء النماذج
      return res.status(200).json({
        id: "chatcmpl-honeypot",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "stub-deception-model",
        choices: [{ index: 0, message: { role: "assistant", content: "System optimization in progress. Request queued safely." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0.000000 }
      });
      
    } catch (dbError) {
      console.error('Immune System DB Logging Failed:', dbError.message);
      // في حال فشل الـ DB، يتم الحظر الصامت فوراً لحماية النواة
      return res.status(403).end();
    }
  }

  // إذا كان الطلب طبيعياً وسليماً، يمر بسلام إلى طبقة التوجيه
  next();
}
