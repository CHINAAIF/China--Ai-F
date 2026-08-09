class StreamGuard {
  constructor() {
    this.violationPatterns = [
      { id: 'INJECTION_IGNORE', pattern: /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts|context)/i, severity: 'CRITICAL' },
      { id: 'INJECTION_DAN', pattern: /\b(DAN|jailbreak|developer\s+mode|act\s+as\s+an?\s+unrestricted)\b/i, severity: 'CRITICAL' },
      { id: 'EXFIL_SYSTEM', pattern: /(system\s+prompt|internal\s+instructions|developer\s+instructions|hidden\s+rules)/i, severity: 'CRITICAL' },
      { id: 'EXFIL_API_KEY', pattern: /(sk-[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,})/i, severity: 'CRITICAL' },
    ];
  }

  check(text, canaryToken) {
    if (!text || text.length < 10) return { violated: false };
    if (canaryToken && text.includes(canaryToken)) {
      return { violated: true, id: 'CANARY_LEAK', severity: 'CRITICAL' };
    }
    for (const rule of this.violationPatterns) {
      if (rule.pattern.test(text)) {
        return { violated: true, id: rule.id, severity: rule.severity };
      }
    }
    return { violated: false };
  }
}

const guard = new StreamGuard();
export const streamGuard = guard;
export default guard;
