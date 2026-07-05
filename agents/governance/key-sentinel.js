/**
 * KeySentinel — مُعطَّل مؤقتاً
 *
 * ملاحظة هندسية (تدقيق أمني):
 * هذا الملف كان يفترض عمود key_encrypted في byok_keys غير موجود فعلياً.
 * التصميم الحقيقي الحي (انظر agents/governance/execution-layer.js) يعتمد
 * على key_hash (SHA-256 أحادي الاتجاه) بدل تشفير عكسي - لا حاجة لفك تشفير.
 * كما كان هذا الملف يحتوي على سر افتراضي مكشوف ('trunkia-key') كـ fallback،
 * وهي ثغرة أمنية أُزيلت هنا بتعطيل الملف بالكامل بدل إصلاحه جزئياً،
 * إلى حين قرار: إما حذفه نهائياً أو إعادة بنائه ليطابق execution-layer.js.
 */
export const keySentinel = {
  name: 'key_sentinel',
  status: 'disabled_pending_redesign',
  async initialize() { return false; },
  async run() {
    return { success: false, error: 'key-sentinel disabled: schema mismatch with byok_keys, see file header' };
  },
  async runDiagnostic() {
    return { agent: 'key_sentinel', status: 'disabled_pending_redesign' };
  }
};
export default keySentinel;
