/**
 * TRUNKIA Sovereign Cryptographic Tokenizer v4.2
 * Deterministic detection with local AES-256-GCM encryption.
 */
import { encrypt, decrypt } from './security-core.js';

function isValidLuhn(number) {
  let sum = 0;
  let isEven = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = parseInt(number[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

const PATTERNS = [
  { type: 'API_KEY', regex: /\b(sk-[a-zA-Z0-9-]{20,}|ghp_[a-zA-Z0-9-]{36}|gsk_[a-zA-Z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/ },
  { type: 'DB_CONN', regex: /\b(?:postgres(?:ql)?|mongodb):\/\/[^\s"']+/i },
  { type: 'ENV_VAR', regex: /\b(?:PASSWORD|SECRET|KEY|TOKEN|API_KEY)\s*[=:]\s*["']?[A-Za-z0-9_\-]{8,}["']?/i },
  { type: 'IBAN', regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{1,30}\b/ },
  // إصلاح محفظة البيتكوين: دعم حتى 59 حرفاً بعد bc1
  { type: 'CRYPTO', regex: /\b(?:bc1[a-z0-9]{39,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/ },
  { type: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,16}\b/, validate: (val) => isValidLuhn(val.replace(/\D/g, '')) },
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
  { type: 'SAUDI_ID', regex: /\b1\d{9}\b/ },
  { type: 'PHONE', regex: /(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { type: 'ORG_AR', regex: /(?:شركة|مؤسسة)\s+([\p{L}]+(?:\s[\p{L}]+)?)(?=[\.,;:!?\n]|$)/u },
  { type: 'NAME_AR', regex: /(?:اسمي|أنا)\s+([\p{L}]+)(?=\s+و|[\.,;:!?\n]|$)/u },
  { type: 'ORG_EN', regex: /(?:work at|company is)\s+([A-Z][a-zA-Z0-9&]+)(?=\s+and|[\.,;:!?\n]|$)/ },
  { type: 'NAME_EN', regex: /(?:my name is|I am)\s+([A-Z][a-z]+)(?=\s+and|[\.,;:!?\n]|$)/ }
];

class PIIRedactor {
  redact(text) {
    if (!text || typeof text !== 'string') return { sanitizedText: text, mapping: {} };

    const matches = [];
    for (const { type, regex, validate } of PATTERNS) {
      const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
      let m;
      while ((m = globalRegex.exec(text)) !== null) {
        const sensitiveValue = m[1] ? m[1] : m[0];
        const startIndex = m.index + (m[0].indexOf(sensitiveValue));
        
        if (validate && !validate(sensitiveValue)) continue;

        matches.push({
          type,
          start: startIndex,
          end: startIndex + sensitiveValue.length,
          value: sensitiveValue.trim()
        });
      }
    }

    matches.sort((a, b) => a.start !== b.start ? a.start - b.start : b.end - a.end);
    const filteredMatches = [];
    let lastEnd = 0;
    for (const m of matches) {
      if (m.start >= lastEnd) {
        filteredMatches.push(m);
        lastEnd = m.end;
      }
    }

    let sanitizedText = "";
    let currentIndex = 0;
    const mapping = {};
    let counter = {};

    for (const m of filteredMatches) {
      sanitizedText += text.substring(currentIndex, m.start);
      
      counter[m.type] = (counter[m.type] || 0) + 1;
      const placeholder = `[TOKEN_${m.type}_${counter[m.type]}]`;
      
      try {
        mapping[placeholder] = encrypt(m.value);
      } catch (e) {
        mapping[placeholder] = m.value;
      }
      
      sanitizedText += placeholder;
      currentIndex = m.end;
    }
    sanitizedText += text.substring(currentIndex);

    return { sanitizedText, mapping };
  }

  reconstruct(text, mapping) {
    if (!text || typeof text !== 'string' || !mapping) return text;
    
    let reconstructedText = text;
    for (const [placeholder, encryptedValue] of Object.entries(mapping)) {
      let decryptedValue = encryptedValue;
      try {
        decryptedValue = decrypt(encryptedValue);
      } catch (e) {}
      reconstructedText = reconstructedText.split(placeholder).join(decryptedValue);
    }
    
    reconstructedText = reconstructedText.replace(/\[TOKEN_[A-Z_]+_\d+\]/g, '[DATA]');
    return reconstructedText;
  }
}

export const piiRedactor = new PIIRedactor();
export default piiRedactor;
