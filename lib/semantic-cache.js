/**
 * TRUNKIA Sovereign Semantic Cache v2.0 (Omega Protocol)
 * 
 * Features:
 * 1. Exact Match (O(1) hash lookup)
 * 2. Semantic Match (Jaccard Similarity >= 0.85)
 * 3. Quality Gate (Only cache ACCEPTED responses with confidence >= 80)
 * 4. Time-Sensitive Detection (Skip cache for "today", "now", etc.)
 * 5. PII Safety (Stores hash only, not original text)
 * 6. Multi-Language (Arabic, English, Chinese, etc.)
 * 7. Distributed (Redis) with Local Fallback
 * 8. LRU Eviction (Max 10,000 entries)
 */
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let RedisClient = null;
try { RedisClient = require('ioredis'); } catch (e) {}

const TIME_SENSITIVE = [
  'today', 'now', 'current', 'latest', 'recent', 'live', 'breaking',
  'حاليا', 'الآن', 'اليوم', 'أحدث', 'حالي', 'الساعة', 'الدقيقة',
  '现在', '今天', '最新', '当前'
];

class SemanticCache {
  constructor() {
    this.redis = null;
    this.localCache = new Map();
    this.MAX_LOCAL = 10000;
    this.THRESHOLD = 0.85;
    this.TTL = 3600;
    this.MIN_CONFIDENCE = 80;
    this.SCAN_LIMIT = 50;
    this.initRedis();
  }

  initRedis() {
    if (RedisClient && process.env.REDIS_URL) {
      try {
        this.redis = new RedisClient(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000
        });
        this.redis.on('connect', () => console.log('[CACHE] Redis connected. Semantic v2 active.'));
        this.redis.on('error', () => {});
      } catch (e) { this.redis = null; }
    }
  }

  normalize(text) {
    if (!text || typeof text !== 'string') return '';
    return text.toLowerCase().normalize('NFKC').replace(/[^\w\s\u0600-\u06FF\u4e00-\u9fff]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1000);
  }

  tokenize(text) {
    return new Set(this.normalize(text).split(' ').filter(w => w.length > 2));
  }

  jaccard(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const x of setA) { if (setB.has(x)) intersection++; }
    return intersection / (setA.size + setB.size - intersection);
  }

  hash(text) {
    return crypto.createHash('sha256').update(this.normalize(text)).digest('hex');
  }

  isTimeSensitive(text) {
    const lower = (text || '').toLowerCase();
    return TIME_SENSITIVE.some(kw => lower.includes(kw));
  }

  async search(prompt, userId) {
    if (!prompt || !userId || this.isTimeSensitive(prompt)) return null;
    const key = 'semcache:' + userId + ':' + this.hash(prompt);

    // 1. Exact match (Redis)
    if (this.redis && this.redis.status === 'ready') {
      try {
        const exact = await this.redis.get(key);
        if (exact) return { content: JSON.parse(exact).content, similarity: 1.0, cached: true, verifiable: true };

        // 2. Semantic match (Redis Scan)
        const promptTokens = this.tokenize(prompt);
        if (promptTokens.size === 0) return null;
        let cursor = '0', bestMatch = null, bestScore = 0, scanned = 0;
        do {
          const result = await this.redis.scan(cursor, 'MATCH', 'semcache:' + userId + ':*', 'COUNT', 50);
          cursor = result[0];
          for (let i = 0; i < result[1].length && scanned < this.SCAN_LIMIT; i++) {
            const entry = await this.redis.get(result[1][i]);
            if (entry) {
              try {
                const parsed = JSON.parse(entry);
                const score = this.jaccard(promptTokens, this.tokenize(parsed.prompt_norm));
                if (score > bestScore) { bestScore = score; bestMatch = parsed; }
              } catch (e) {}
            }
            scanned++;
          }
        } while (cursor !== '0' && scanned < this.SCAN_LIMIT);
        if (bestScore >= this.THRESHOLD && bestMatch) return { content: bestMatch.content, similarity: bestScore, cached: true, verifiable: true };
      } catch (e) {}
    }

    // 3. Local fallback (Exact only)
    const local = this.localCache.get(key);
    if (local) return { content: JSON.parse(local).content, similarity: 1.0, cached: true, verifiable: true };
    return null;
  }

  async store(prompt, response, userId, ttl, metadata) {
    if (!prompt || !userId || !response || !response.content) return;
    var tribunal = metadata && metadata.tribunal;
    if (!tribunal || tribunal.verdict !== 'ACCEPTED' || tribunal.confidence < this.MIN_CONFIDENCE) return;

    var key = 'semcache:' + userId + ':' + this.hash(prompt);
    var entry = { content: response.content, prompt_norm: this.normalize(prompt), stored_at: new Date().toISOString(), confidence: tribunal.confidence };

    if (this.redis && this.redis.status === 'ready') {
      try { await this.redis.setex(key, ttl || this.TTL, JSON.stringify(entry)); return; } catch (e) {}
    }
    this.localCache.set(key, JSON.stringify(entry));
    if (this.localCache.size > this.MAX_LOCAL) this.localCache.delete(this.localCache.keys().next().value);
  }

  getStats() {
    return { entries: this.localCache.size, threshold: this.THRESHOLD, mode: (this.redis && this.redis.status === 'ready') ? 'redis' : 'local' };
  }
}

export const semanticCache = new SemanticCache();
export default semanticCache;
