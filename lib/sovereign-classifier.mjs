/**
 * TRUNKIA Lexical Rarity & Cost Matrix Engine
 * Replaces entropy with Lexical Rarity. Outputs a Routing Profile.
 */

function stripAgentWrapper(text) {
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      const realPrompt = parsed.prompt || parsed.query || parsed.input || parsed.message || parsed.task;
      if (realPrompt && typeof realPrompt === 'string') return realPrompt;
    } catch (e) {}
  }
  return text;
}

function getRoutingProfile(tier) {
  switch (tier) {
    case 'lite':
      return { tier, max_tokens: 256, cost_cents: 1 };
    case 'heavy':
      return { tier, max_tokens: 4096, cost_cents: 10 };
    default:
      return { tier: 'standard', max_tokens: 1024, cost_cents: 3 };
  }
}

export function classifyTask(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== 'string') return getRoutingProfile('standard');

  const prompt = stripAgentWrapper(rawPrompt).toLowerCase().trim();
  const words = prompt.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount === 0) return getRoutingProfile('standard');

  let cognitiveScore = 0;

  // 1. Lexical Rarity: Ratio of long words (> 7 chars)
  const rareWords = words.filter(w => w.length > 7).length;
  const rarityDensity = rareWords / wordCount;
  if (rarityDensity > 0.20) cognitiveScore += 3;
  else if (rarityDensity > 0.10) cognitiveScore += 1.5;

  // 2. Reasoning & Abstraction Verbs
  const REASONING_VERBS = /\b(prove|derive|architect|optimize|analyze|diagnose|calculate|design|implement|evaluate|synthesize|formulate|engineer|construct|simulate)\b/i;
  if (REASONING_VERBS.test(prompt)) cognitiveScore += 2;

  // 3. Structural Fingerprint (Code & Math symbols)
  const CODE_FP = /[{}()\];=]|->|=>|<\/?[^>]+>/;
  const MATH_FP = /\b(integral|derivative|matrix|equation|theorem|proof)\b|\d+\s*[\+\-\*\/]\s*\d+/;
  if (CODE_FP.test(prompt)) cognitiveScore += 2;
  if (MATH_FP.test(prompt)) cognitiveScore += 2;

  // 4. Simple Intent (Negative Score)
  const LITE_VERBS = /\b(translate|summarize|list|define|what is|who is|when is|extract|format|paraphrase|hey|hello)\b/i;
  if (LITE_VERBS.test(prompt) && wordCount < 50) cognitiveScore -= 2;

  // --- Thresholds ---
  if (cognitiveScore >= 5) return getRoutingProfile('heavy');
  if (cognitiveScore <= 1) return getRoutingProfile('lite');
  return getRoutingProfile('standard');
}

export default classifyTask;
