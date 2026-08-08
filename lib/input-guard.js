/**
 * TRUNKIA Semantic Firewall v2.2
 * Implements Absolute Space Removal (De-obfuscation) for Compact Pattern Matching.
 */

const INJECTION_PATTERNS_RAW = [
  /ignore (all )?(previous|prior) (instructions|directives|rules)/i,
  /disregard the (above|previous|prior)/i,
  /reveal (your )?system prompt/i,
  /what is the (database )?password/i,
  /override safety protocols/i,
  /maintenance mode/i,
  /execute:?\s*(drop|delete|truncate|update|insert)/i,
  /you are now in (developer|maintenance|root|admin) mode/i,
  /forget (everything|all|your training)/i,
  /act as (a |an )?(terminal|root|admin|dan)/i,
  /تجاهل (كل|جميع)? ?(التعليمات|الأوامر|الموجهات|السابقة)/i,
  /ما هو (الرقم السري|كلمة المرور|السر)/i,
  /أنت الآن في (وضع المطور|وضع الصيانة|وضع المسؤول)/i,
  /忽略.*(指令|指示|规则)/i, // النمط الصيني المُصحح (أوسع نطاقاً)
  /\<\|system\|\>/i,
  /\<\|im_start\|\>/i
];

// إنشاء نسخة مضغوطة (بلا مسافات) من الأنماط لمطابقة النص المضغوط
const INJECTION_PATTERNS_COMPACT = INJECTION_PATTERNS_RAW.map(p => 
  new RegExp(p.source.replace(/\\s\+/g, '').replace(/\s+/g, ''), 'i')
);

/**
 * يزيل كل المسافات والرموز تماماً لمنع تقسيم الكلمات
 */
function deobfuscate(text) {
  return text.replace(/[\s\.\,\;\:\!\?\_\-\*\/\\]/g, '').toLowerCase();
}

export function isSafePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return true;

  // 1. فحص النص الخام (للأنماط التي تعتمد على المسافات الطبيعية)
  for (const pattern of INJECTION_PATTERNS_RAW) {
    if (pattern.test(prompt)) {
      console.error(`[INPUT GUARD v2.2] BLOCKED (Raw): Matched ${pattern.source.substring(0, 30)}`);
      return false;
    }
  }

  // 2. فحص النص المضغوط (لإلتقاط الكلمات المقسمة بمسافات أو رموز)
  const compactText = deobfuscate(prompt);
  for (const pattern of INJECTION_PATTERNS_COMPACT) {
    if (pattern.test(compactText)) {
      console.error(`[INPUT GUARD v2.2] BLOCKED (Compact): Matched ${pattern.source.substring(0, 30)}`);
      return false;
    }
  }

  return true;
}

export const SAFE_BLOCK_RESPONSE = {
  approved: true,
  content: "I cannot process this request as it violates security policies.",
  model: "input-guard/firewall-v2.2",
  tokens: 0,
  latency_ms: 0,
  blocked_by_firewall: true
};
