/**
 * TRUNKIA Sovereign Semantic Cache (Strict Memory-Bounded LRU)
 * Implements true LRU eviction, IDF garbage collection, and configurable memory limits.
 */
import crypto from 'crypto';

class SemanticCache {
  constructor() {
    // إجبار الحدود عبر متغيرات البيئة لمنع انفجار الذاكرة (OOM)
    this.maxSize = parseInt(process.env.CACHE_MAX_ENTRIES || '1000', 10);
    this.similarityThreshold = parseFloat(process.env.CACHE_SIMILARITY || '0.90');
    this.cache = new Map(); // Map في JS يحافظ على ترتيب الإدراج، نستخدمه لـ LRU
    this.documentFrequency = new Map();
    this.totalDocuments = 0;
    this.stats = { hits: 0, misses: 0, tokens_saved: 0, cost_saved_usd: 0 };

    // مجمع القمامة (Garbage Collector) يعمل كل ساعة لتنظيف مفردات الـ IDF
    setInterval(() => this._pruneVocabulary(), 3600000).unref();
  }

  _pruneVocabulary() {
    let pruned = 0;
    for (const [term, df] of this.documentFrequency.entries()) {
      if (df <= 0) {
        this.documentFrequency.delete(term);
        pruned++;
      }
    }
    if (pruned > 0) console.log(`[SemanticCache] GC: Pruned ${pruned} unused terms from vocabulary.`);
  }

  _tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  _buildVector(text) {
    const tokens = this._tokenize(text);
    const tf = new Map();
    tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    
    const vector = {};
    tf.forEach((count, term) => {
      const idf = Math.log((this.totalDocuments + 1) / ((this.documentFrequency.get(term) || 0) + 1)) + 1;
      vector[term] = (count / tokens.length) * idf;
    });
    return vector;
  }

  _cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (const key in vecA) {
      if (vecB[key]) dotProduct += vecA[key] * vecB[key];
      normA += Math.pow(vecA[key], 2);
    }
    for (const key in vecB) {
      normB += Math.pow(vecB[key], 2);
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  search(prompt, userId) {
    const requestVector = this._buildVector(prompt);
    let bestMatch = null;
    let bestMatchKey = null;
    let highestScore = 0;

    for (const [key, entry] of this.cache.entries()) {
      // أمن صارم: لا تطابق بين مستخدمين مختلفين
      if (entry.userId !== userId) continue;
      
      const score = this._cosineSimilarity(requestVector, entry.vector);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = entry;
        bestMatchKey = key;
      }
    }

    if (highestScore >= this.similarityThreshold && bestMatch) {
      // True LRU: حذف وإعادة إدراج لجعله الأحدث استخداماً
      this.cache.delete(bestMatchKey);
      this.cache.set(bestMatchKey, bestMatch);

      this.stats.hits++;
      this.stats.tokens_saved += bestMatch.tokens || 0;
      this.stats.cost_saved_usd += (bestMatch.tokens || 0) * 0.0000005;
      
      console.log(`[SemanticCache] HIT (Score: ${highestScore.toFixed(3)})`);
      return { ...bestMatch.response, cached: true, similarity: highestScore };
    }

    this.stats.misses++;
    return null;
  }

  store(prompt, response, userId, tokens = 0) {
    // إذا امتلأت الذاكرة، نحذف الأقل استخداماً (أول عنصر في Map)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      const evicted = this.cache.get(oldestKey);
      
      // تحديث الـ IDF لتقليل تكرار الكلمات المحذوفة
      this._tokenize(evicted.vector_text).forEach(t => {
        const currentDf = this.documentFrequency.get(t);
        if (currentDf) this.documentFrequency.set(t, currentDf - 1);
      });
      this.totalDocuments--;
      this.cache.delete(oldestKey);
    }

    const vector = this._buildVector(prompt);
    // زيادة تكرار الكلمات الجديدة
    this._tokenize(prompt).forEach(t => this.documentFrequency.set(t, (this.documentFrequency.get(t) || 0) + 1));
    this.totalDocuments++;

    const key = crypto.createHash('sha256').update(prompt + userId).digest('hex');
    this.cache.set(key, {
      vector,
      vector_text: prompt,
      response,
      tokens,
      userId,
      timestamp: Date.now()
    });
  }


  flush() {
    this.cache.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
    this.stats = { hits: 0, misses: 0, tokens_saved: 0, cost_saved_usd: 0 };
    console.log('[SemanticCache] Cache flushed successfully.');
  }

  getStats() {
    return {
      ...this.stats,
      cache_size: this.cache.size,
      max_size: this.maxSize,
      vocabulary_size: this.documentFrequency.size,
      hit_rate: this.stats.hits + this.stats.misses > 0 ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(2) + '%' : '0%'
    };
  }
}

export const semanticCache = new SemanticCache();
