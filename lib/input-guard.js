/**
 * TRUNKIA Input Guard (Semantic Firewall)
 * Blocks Prompt Injection attacks before they reach the LLM.
 */

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /disregard the (above|previous)/i,
  /reveal (your )?system prompt/i,
  /what is the (database )?password/i,
  /override safety protocols/i,
  /maintenance mode/i,
  /execute:?\s*(drop|delete|truncate|update|insert)/i,
  /you are now in (developer|maintenance|root) mode/i,
  /\<\|system\|\>/i,
  /\<\|im_start\|\>/i
];

/**
 * يفحص الطلب ويحدد إذا كان خبيثاً
 * @returns {boolean} true إذا كان الطلب آمناً، false إذا كان محاولة اختراق
 */
export function isSafePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return true;
  
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      console.error(`[INPUT GUARD] BLOCKED: Prompt matched injection pattern: ${pattern.source}`);
      return false;
    }
  }
  return true;
}

/**
 * الرد الآمن الذي يُرجع للوكيل إذا تم اعتراض الطلب
 */
export const SAFE_BLOCK_RESPONSE = {
  approved: true,
  content: "I cannot process this request as it violates security policies. I am here to provide safe and helpful assistance within my operational guidelines.",
  model: "input-guard/firewall",
  tokens: 0,
  latency_ms: 0,
  blocked_by_firewall: true
};
