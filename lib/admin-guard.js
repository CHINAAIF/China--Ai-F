import crypto from 'crypto';

/**
 * TRUNKIA Sovereign Admin Guard
 * Implements HMAC Request Signing & Replay Attack Prevention.
 * This is the standard used by AWS and Stripe for API endpoints.
 */

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ENCRYPTION_KEY;
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Middleware للتحقق من صحة الطلب الإداري
 */
export function adminGuard(req, res, next) {
  const signature = req.headers['x-admin-signature'];
  const timestamp = req.headers['x-admin-timestamp'];
  const path = req.path;
  const method = req.method;

  // 1. التحقق من وجود البيانات الأساسية
  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'SECURITY: Missing admin credentials.' });
  }

  // 2. الحماية من إعادة التشغيل (Replay Attack Prevention)
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  
  if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > MAX_REQUEST_AGE_MS) {
    return res.status(401).json({ error: 'SECURITY: Request timestamp expired or invalid.' });
  }

  // 3. بناء سلسلة التوقيع (String to Sign)
  // الصيغة: METHOD|PATH|TIMESTAMP|BODY_HASH
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const stringToSign = `${method}|${path}|${requestTime}|${bodyHash}`;

  // 4. حساب التوقيع المتوقع
  const expectedSignature = crypto.createHmac('sha256', ADMIN_SECRET).update(stringToSign).digest('hex');

  // 5. مقارنة آمنة ضد هجمات التوقيت (Timing-Safe Comparison)
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    // تأخير عشوائي لمحاكاة الاستجابة العادية وتضليل الهاكر
    setTimeout(() => {
      return res.status(403).json({ error: 'SECURITY: Invalid signature. Access Denied.' });
    }, Math.random() * 500);
    return;
  }

  // إذا نجح التحقق، اسمح بالمرور
  next();
}
