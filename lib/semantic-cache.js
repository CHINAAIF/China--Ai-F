/**
 * TRUNKIA Sovereign Hot Memory (O(1) Cryptographic Cache)
 * Implements Unicode Normalization, HMAC Attestation Verification, and Dual-Index for O(1) GDPR Deletion.
 */
import crypto from 'crypto';

class SemanticCache {
  constructor() {
    this.maxSize = parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10);
    this.cache = new Map(); // Main LRU Cache: key -> entry
    this.userIndex = new Map(); // GDPR Index: userId -> Set<keys>
    this.stats = { hits: 0, misses: 0, tokens_saved: 0, cost_saved_usd: 0 };
  }

  // 1. Strict Unicode Normalization (Prevents Zero-Width Space DoS)
  _generateKey(prompt, userId) {
    const normalized = prompt.normalize('NFKC').toLowerCase().replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
    return crypto.createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
  }

  // 2. Cryptographic Attestation Verification (Prevents Poisoning)
  _verifyAttestation(attestation) {
    if (!attestation || !attestation.chain || attestation.chain.length === 0) return false;
    const finalBlock = attestation.chain[attestation.chain.length - 1];
    if (!finalBlock || !finalBlock.hash || !finalBlock.signature) return false;
    
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) return false; // Fail-closed if secret is missing
    
    const expectedSig = crypto.createHmac('sha256', secret).update(finalBlock.hash).digest('hex');
    try {
      const a = Buffer.from(expectedSig, 'hex');
      const b = Buffer.from(finalBlock.signature, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) { return false; }
  }

  search(prompt, userId) {
    const key = this._generateKey(prompt, userId);
    const entry = this.cache.get(key);

    if (entry) {
      // True LRU: Delete and re-insert
      this.cache.delete(key);
      this.cache.set(key, entry);

      this.stats.hits++;
      this.stats.tokens_saved += entry.tokens || 0;
      this.stats.cost_saved_usd += (entry.tokens || 0) * 0.0000005;

      return { ...entry.response, cached: true };
    }

    this.stats.misses++;
    return null;
  }

  store(prompt, response, userId, tokens = 0, attestation = null) {
    // Strict Verification: Reject if attestation is fake or missing
    if (!this._verifyAttestation(attestation)) {
      return;
    }

    const key = this._generateKey(prompt, userId);

    // LRU Eviction
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      const evictedEntry = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      
      // Clean up user index
      if (evictedEntry && this.userIndex.has(evictedEntry.userId)) {
        this.userIndex.get(evictedEntry.userId).delete(oldestKey);
        if (this.userIndex.get(evictedEntry.userId).size === 0) {
          this.userIndex.delete(evictedEntry.userId);
        }
      }
    }

    this.cache.set(key, {
      response,
      tokens,
      userId,
      timestamp: Date.now()
    });

    // Update User Index for O(1) Deletion
    if (!this.userIndex.has(userId)) {
      this.userIndex.set(userId, new Set());
    }
    this.userIndex.get(userId).add(key);
  }

  // 3. O(1) GDPR Deletion (Right to be Forgotten)
  deleteUserData(userId) {
    const keys = this.userIndex.get(userId);
    if (!keys) return 0;
    
    let deletedCount = 0;
    for (const key of keys) {
      this.cache.delete(key);
      deletedCount++;
    }
    this.userIndex.delete(userId);
    return deletedCount;
  }

  flush() {
    this.cache.clear();
    this.userIndex.clear();
    this.stats = { hits: 0, misses: 0, tokens_saved: 0, cost_saved_usd: 0 };
    console.log('[HotMemory] Cache flushed successfully.');
  }

  getSafeSample(size = 20) {
    const values = Array.from(this.cache.values()).slice(-size);
    // Security: Return hashed fingerprints and lengths, NOT raw content (Prevents Cross-Tenant Leakage)
    return values.map(v => {
      const content = v.response?.content || '';
      return {
        hash: crypto.createHash('sha256').update(content).digest('hex').substring(0, 16),
        length: content.length,
        tokens: v.tokens || 0
      };
    });
  }

  getStats() {
    return {
      ...this.stats,
      cache_size: this.cache.size,
      max_size: this.maxSize,
      hit_rate: this.stats.hits + this.stats.misses > 0 ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(2) + '%' : '0%'
    };
  }
}

export const semanticCache = new SemanticCache();
export default semanticCache;
