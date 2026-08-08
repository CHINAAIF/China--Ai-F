/**
 * TRUNKIA Deterministic Grounding Engine v2.1 (Omega Protocol)
 * Fixed Arabic Word Boundaries using Lookahead.
 */

class GroundingEngine {
  // Bilingual Lexical Maps (Arabic uses Lookahead instead of \b)
  static LEXICON = {
    negation: /\b(not|never|don't|doesn't|isn't|aren't|wasn't|weren't|won't|can't|cannot|no)\b|(?<=\s|^)(لا|ليس|لم|لن|غير|بدون)(?=\s|$|[.,!?؟،؛:—])/gi,
    absolute: /\b(always|every|all|none|everyone|nobody|never)\b|(?<=\s|^)(دائما|كل|الجميع|لا أحد|أبدا)(?=\s|$|[.,!?؟،؛:—])/gi,
    partial: /\b(sometimes|occasionally|some|few|many|often|usually)\b|(?<=\s|^)(أحيانا|بعض|قليل|كثيرا|عادة)(?=\s|$|[.,!?؟،؛:—])/gi,
    hedging: /\b(maybe|perhaps|possibly|probably|likely|might|could be|I think|I believe|seems|appears|approximately|roughly)\b|(?<=\s|^)(ربما|قد|يمكن|أظن|أعتقد|يبدو|من المحتمل|تقريبا)(?=\s|$|[.,!?؟،؛:—])/gi,
    assertive: /\b(definitely|certainly|absolutely|exactly|precisely|undoubtedly|factually|confirmed|verified|clearly)\b|(?<=\s|^)(بالتأكيد|قطعا|بلا شك|من المؤكد|حقا|فعلا|بدون شك|بوضوح)(?=\s|$|[.,!?؟،؛:—])/gi,
    fabrication: /\b(according to [a-z]+|research shows|studies show|experts say|it is known that|it is widely believed)\b|(?<=\s|^)(وفقا ل|أبحاث|دراسات|خبراء|يُعرف أن|يُعتقد)(?=\s|$|[.,!?؟،؛:—])/gi
  };

  smartSplit(text) {
    const cleanText = this.stripCodeBlocks(text);
    const sentences = cleanText.split(/(?<!\d)(?<![A-Z]\.)([.!?؟])\s+/);
    const result = [];
    for (let i = 0; i < sentences.length; i += 2) {
      if (sentences[i] && sentences[i].trim().length > 5) {
        let s = sentences[i].trim() + (sentences[i+1] || '');
        if (!s.match(/^(do not|don't|please|let's|let us|make sure|ensure|remember|note that|keep in mind|لا|من فضلك|تذكر|لاحظ)/i)) {
          result.push(s);
        }
      }
    }
    return result;
  }

  stripCodeBlocks(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' [CODE_BLOCK] ')
      .replace(/`[^`]*`/g, ' [CODE_INLINE] ');
  }

  extractSignificantWords(text) {
    // Match English words (4+) and Arabic words (4+)
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b|[\u0600-\u06FF]{4,}/g) || [];
    return new Set(words);
  }

  hasContradiction(c1, c2) {
    const c1Neg = (c1.match(GroundingEngine.LEXICON.negation) || []).length > 0;
    const c2Neg = (c2.match(GroundingEngine.LEXICON.negation) || []).length > 0;

    const c1Abs = (c1.match(GroundingEngine.LEXICON.absolute) || []).length > 0;
    const c2Par = (c2.match(GroundingEngine.LEXICON.partial) || []).length > 0;
    const c1Par = (c1.match(GroundingEngine.LEXICON.partial) || []).length > 0;
    const c2Abs = (c2.match(GroundingEngine.LEXICON.absolute) || []).length > 0;

    const isNegConflict = c1Neg !== c2Neg;
    const isQuantConflict = (c1Abs && c2Par) || (c1Par && c2Abs);

    if (isNegConflict || isQuantConflict) {
      const words1 = this.extractSignificantWords(c1);
      const words2 = this.extractSignificantWords(c2);
      const overlap = [...words1].filter(w => words2.has(w));
      return overlap.length >= 1;
    }
    return false;
  }

  detectContradictions(claims) {
    const contradictions = [];
    const limited = claims.slice(0, 50);

    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        if (this.hasContradiction(limited[i], limited[j])) {
          contradictions.push({ claim1: limited[i], claim2: limited[j] });
        }
      }
    }
    return contradictions;
  }

  scoreConfidence(text) {
    const hedgeCount = (text.match(GroundingEngine.LEXICON.hedging) || []).length;
    const assertiveCount = (text.match(GroundingEngine.LEXICON.assertive) || []).length;
    let confidence = 75 + (assertiveCount * 5) - (hedgeCount * 10);
    return Math.max(10, Math.min(95, confidence));
  }

  detectFabrication(text) {
    return text.match(GroundingEngine.LEXICON.fabrication) || [];
  }

  ground(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { grounded: true, confidence: 100, contradictions: [], claims: 0, fabrication: [], warnings: [] };
    }

    const claims = this.smartSplit(text);
    const contradictions = this.detectContradictions(claims);
    const confidence = this.scoreConfidence(text);
    const fabrication = this.detectFabrication(text);

    const warnings = [];
    if (contradictions.length > 0) warnings.push(`${contradictions.length} contradiction(s)`);
    if (confidence < 50) warnings.push('Low confidence (hedging)');
    if (fabrication.length > 0) warnings.push(`${fabrication.length} vague sourcing`);

    return {
      grounded: contradictions.length === 0,
      confidence,
      contradictions: contradictions.length,
      claims: claims.length,
      fabrication,
      warnings
    };
  }
}

export const groundingEngine = new GroundingEngine();
export default groundingEngine;
