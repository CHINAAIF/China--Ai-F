import crypto from 'crypto';
import fs from 'fs';

// ============================================================
// 1) ENCRYPTION_KEY — فحص صارم، لا fallback أبداً، فحص إنتروبيا
// ============================================================
const WEAK_KEYS = new Set([
  'default-key-32-chars-minimum!!',
  '00000000000000000000000000000000',
  'changeme-changeme-changeme-change',
]);

export function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('🔴 ENCRYPTION_KEY غير موجود في البيئة — توقف فوري.');
  }
  if (key.length < 32) {
    throw new Error(`🔴 ENCRYPTION_KEY قصير (${key.length} حرف) — الحد الأدنى 32.`);
  }
  if (WEAK_KEYS.has(key)) {
    throw new Error('🔴 ENCRYPTION_KEY يطابق مفتاح افتراضي معروف — يجب توليد مفتاح حقيقي.');
  }
  // فحص إنتروبيا تقريبي: لو كل الحروف متكررة (aaaa...) أو تسلسلية
  const uniqueChars = new Set(key).size;
  if (uniqueChars < 8) {
    throw new Error('🔴 ENCRYPTION_KEY منخفض التنوع (إنتروبيا ضعيفة) — لا يصلح كمفتاح تشفير.');
  }
  return key;
}

// أداة لتوليد مفتاح قوي عشوائي (استخدمها مرة واحدة، ثم خزّن النتيجة بـ.env / secret manager)
export function generateStrongKey() {
  return crypto.randomBytes(32).toString('hex'); // 64 حرف hex
}

// ============================================================
// 2) HASH + HMAC — دالة موحّدة، لا تكتب الحساب يدوياً بكل مكان
// ============================================================
export function hashPayload(rawString) {
  if (typeof rawString !== 'string' || rawString.length === 0) {
    throw new Error('🔴 لا يمكن حساب hash لـ payload فاضي أو غير نصي — هذا هو سبب أي "pending" مستقبلي.');
  }
  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

export function signHash(hash, key = getEncryptionKey()) {
  return crypto.createHmac('sha256', key).update(hash).digest('hex');
}

export function hashAndSign(rawString) {
  const key = getEncryptionKey();
  const hash = hashPayload(rawString);
  const signature = signHash(hash, key);
  return { hash, signature };
}

// تحقق لاحق: يثبت أن signature يطابق الـhash فعلاً (كشف تلاعب)
export function verifySignature(hash, signature, key = getEncryptionKey()) {
  const expected = signHash(hash, key);
  // مقارنة بزمن ثابت لمنع timing attack
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ============================================================
// 3) SSL — تحميل CA الحقيقية بدل تعطيل الفحص
// ============================================================
export function getDbSslConfig() {
  const caPath = process.env.DB_CA_CERT_PATH;
  if (caPath && fs.existsSync(caPath)) {
    return { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }
  // لو ما فيه CA مخصصة، استخدم فحص النظام الافتراضي (لا تعطّله أبداً)
  console.warn('⚠️  DB_CA_CERT_PATH غير محدد — يُستخدم فحص الشهادات الافتراضي للنظام.');
  return { rejectUnauthorized: true };
}

// ============================================================
// 4) Redaction — حجب base64 بدون استهلاك المسافات وبدون رفع الحد
// ============================================================
export const SAFE_BASE64_REDACT_PATTERN =
  /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g;

export function redactBase64(text) {
  return text.replace(SAFE_BASE64_REDACT_PATTERN, '[REDACTED_B64]');
}
