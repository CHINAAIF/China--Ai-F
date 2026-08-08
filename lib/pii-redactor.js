/**
 * TRUNKIA Sovereign PII Vault v14.1 (Omega Protocol - Cloud Edition)
 * Distributed Mapping via Redis + Absolute Hold Strategy for Crash Resilience.
 */
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let RedisClient = null;
try {
  RedisClient = require('ioredis');
} catch (e) {
  console.warn('[PII] ioredis not available. Local-only mode.');
}

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
  constructor() {
    this.redis = null;
    this.initRedis();
  }

  initRedis() {
    if (RedisClient && process.env.REDIS_URL) {
      try {
        this.redis = new RedisClient(process.env.REDIS_URL, {
          retryStrategy: (times) => Math.min(times * 50, 2000),
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          connectTimeout: 5000
        });
        this.redis.on('error', (e) => console.warn('[PII] Redis error:', e.message));
        this.redis.on('connect', () => console.log('[PII] Redis connected. Distributed PII mode active.'));
      } catch (e) {
        console.warn('[PII] Redis init failed. Local-only mode.');
        this.redis = null;
      }
    } else {
      console.warn('[PII] No REDIS_URL. Local-only mode.');
    }
  }

  async redact(text, sessionId = null) {
    if (!text || typeof text !== 'string') return { sanitizedText: text, mapping: new Map(), sessionId: sessionId || crypto.randomUUID() };
    const sid = sessionId || crypto.randomUUID();
    const mapping = new Map();
    let sanitizedText = text;
    const redisOps = [];

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
        if (this.redis) redisOps.push(this.redis.hset(`pii:${sid}`, surrogate, originalValue));
      }
    }

    if (this.redis && redisOps.length > 0) {
      try { await Promise.all(redisOps); await this.redis.expire(`pii:${sid}`, 300); } catch (e) { console.warn('[PII] Redis persist failed.', e.message); }
    }
    return { sanitizedText, mapping, sessionId: sid };
  }

  async reconstruct(text, sessionId = null, mapping = null) {
    if (!text || typeof text !== 'string') return text;
    let reconstructedText = text;
    if (mapping && mapping.size > 0) {
      for (const [surrogate, originalValue] of mapping.entries()) reconstructedText = reconstructedText.split(surrogate).join(originalValue);
    } else if (sessionId && this.redis) {
      try {
        const redisMapping = await this.redis.hgetall(`pii:${sessionId}`);
        if (redisMapping) for (const [s, v] of Object.entries(redisMapping)) reconstructedText = reconstructedText.split(s).join(v);
      } catch (e) { console.warn('[PII] Redis load failed.', e.message); }
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
      if (safeMapping.size === 0) {
        for (const prefix of SURROGATE_PREFIXES) {
          if (text.endsWith(prefix) && prefix.length > maxLen) maxLen = prefix.length;
          for (let i = 1; i < prefix.length; i++) {
            if (text.endsWith(prefix.substring(0, i)) && i > maxLen) maxLen = i;
          }
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
          for (const [surrogate, originalValue] of safeMapping.entries()) safeText = safeText.split(surrogate).join(originalValue);
          const carryOverLen = findLongestSuffixPrefix(safeText);
          if (carryOverLen > 0) {
            toSend = safeText.substring(0, safeText.length - carryOverLen);
            buffer = safeText.substring(safeText.length - carryOverLen);
          } else { toSend = safeText; buffer = ''; }
        } else {
          // Crash Mode: Absolute Hold Strategy
          let firstPrefixIndex = -1;
          for (const prefix of SURROGATE_PREFIXES) {
            const idx = safeText.indexOf(prefix);
            if (idx !== -1 && (firstPrefixIndex === -1 || idx < firstPrefixIndex)) firstPrefixIndex = idx;
          }
          if (firstPrefixIndex !== -1) {
            toSend = safeText.substring(0, firstPrefixIndex);
            buffer = safeText.substring(firstPrefixIndex);
          } else { toSend = safeText; buffer = ''; }
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

  async cleanupSession(sessionId) {
    if (this.redis && sessionId) try { await this.redis.del(`pii:${sessionId}`); } catch (e) {}
  }

  async redisHealth() {
    if (!this.redis) return { connected: false, mode: 'local' };
    try { await this.redis.ping(); return { connected: true, mode: 'distributed' }; } catch (e) { return { connected: false, mode: 'local', error: e.message }; }
  }
}

export const piiRedactor = new PIIRedactor();
export default piiRedactor;
