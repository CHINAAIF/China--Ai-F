/**
 * TRUNKIA Sovereign PII Vault v13.0 (Omega Protocol)
 * Absolute Hold Strategy: Prevents Partial Surrogate Leakage during Crash.
 */
import crypto from 'crypto';

const PATTERNS = [
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g, surrogateGen: (hex) => `user-${hex}@example.com` },
  { type: 'PHONE', regex: /(?:(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\b05\d{8}\b)/g, surrogateGen: (hex) => `000-000-000-${hex}` },
  { type: 'SAUDI_ID', regex: /\b1\d{9}\b/g, surrogateGen: (hex) => `100000000-${hex}` },
  { type: 'IPV4', regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, surrogateGen: (hex) => `192.0.2.${hex}` },
  { type: 'API_KEY', regex: /\b(?:sk-[a-zA-Z0-9-]{20,}|ghp_[a-zA-Z0-9-]{36}|gsk_[a-zA-Z0-9-]{20,})\b/g, surrogateGen: (hex) => `sk-REDACTED-${hex}` }
];

const RESIDUAL_FULL_PATTERNS = [
  /user-[a-f0-9]{6}@example\.com/g,
  /000-000-000-[a-f0-9]{6}/g,
  /100000000-[a-f0-9]{6}/g,
  /192\.0\.2\.[a-f0-9]{6}/g,
  /sk-REDACTED-[a-f0-9]{6}/g
];

const SURROGATE_PREFIXES = ['user-', '000-000-000-', '100000000-', '192.0.2.', 'sk-REDACTED-'];

function sanitizeResidual(text) {
  let cleaned = text;
  for (const pattern of RESIDUAL_FULL_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }
  return cleaned;
}

class PIIRedactor {
  redact(text) {
    if (!text || typeof text !== 'string') return { sanitizedText: text, mapping: new Map() };
    const mapping = new Map();
    let sanitizedText = text;
    for (const { regex, surrogateGen } of PATTERNS) {
      const globalRegex = new RegExp(regex.source, 'g');
      let match;
      const uniqueMatches = new Set();
      while ((match = globalRegex.exec(sanitizedText)) !== null) uniqueMatches.add(match[0]);
      for (const originalValue of uniqueMatches) {
        const hex = crypto.randomBytes(3).toString('hex');
        const surrogate = surrogateGen(hex);
        mapping.set(surrogate, originalValue);
        sanitizedText = sanitizedText.split(originalValue).join(surrogate);
      }
    }
    return { sanitizedText, mapping };
  }

  reconstruct(text, mapping) {
    if (!text || typeof text !== 'string') return text;
    let reconstructedText = text;
    if (mapping && mapping.size > 0) {
      for (const [surrogate, originalValue] of mapping.entries()) {
        reconstructedText = reconstructedText.split(surrogate).join(originalValue);
      }
    }
    return sanitizeResidual(reconstructedText);
  }

  createStreamReconstructor(mapping) {
    let buffer = '';
    const safeMapping = mapping instanceof Map ? mapping : new Map();
    
    const findLongestSuffixPrefix = (text) => {
      let maxLen = 0;
      for (const surrogate of safeMapping.keys()) {
        for (let i = 1; i < surrogate.length; i++) {
          if (text.endsWith(surrogate.substring(0, i)) && i > maxLen) maxLen = i;
        }
      }
      return maxLen;
    };

    return {
      process(chunk) {
        if (!chunk) return '';
        buffer += chunk;
        let safeText = buffer;
        let toSend = '';

        if (safeMapping.size > 0) {
          // Normal Mode: Mapping Exists
          for (const [surrogate, originalValue] of safeMapping.entries()) {
            safeText = safeText.split(surrogate).join(originalValue);
          }
          const carryOverLen = findLongestSuffixPrefix(safeText);
          if (carryOverLen > 0) {
            toSend = safeText.substring(0, safeText.length - carryOverLen);
            buffer = safeText.substring(safeText.length - carryOverLen);
          } else {
            toSend = safeText;
            buffer = '';
          }
        } else {
          // Crash Mode: Absolute Hold Strategy
          let firstPrefixIndex = -1;
          for (const prefix of SURROGATE_PREFIXES) {
            const idx = safeText.indexOf(prefix);
            if (idx !== -1 && (firstPrefixIndex === -1 || idx < firstPrefixIndex)) firstPrefixIndex = idx;
          }
          
          if (firstPrefixIndex !== -1) {
            // Hold back everything from the first prefix onwards
            toSend = safeText.substring(0, firstPrefixIndex);
            buffer = safeText.substring(firstPrefixIndex);
          } else {
            toSend = safeText;
            buffer = '';
          }
        }
        
        return sanitizeResidual(toSend);
      },
      flush() {
        let remaining = buffer;
        buffer = '';
        return sanitizeResidual(remaining);
      }
    };
  }
}

export const piiRedactor = new PIIRedactor();
export default piiRedactor;
