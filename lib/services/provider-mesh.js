/**
 * TRUNKIA Provider Mesh v2.0 (Omega Protocol - Intelligent Routing)
 * 
 * Enterprise Features:
 * 1. Provider Health Tracking (Success rate, avg latency, total tokens)
 * 2. Health-Based Chain Sorting (Best providers first)
 * 3. Failure Penalty (Exponential backoff for failing providers)
 * 4. Zero Overhead (No racing, no dual-track, pure sequential failover)
 */
class ProviderMesh {
  constructor() {
    this.health = new Map();
  }

  recordSuccess(providerName, latencyMs, tokensGenerated) {
    const stats = this.health.get(providerName) || {
      successes: 0, failures: 0, totalTokens: 0, totalLatency: 0, lastSuccess: null, penalty: 0
    };
    stats.successes++;
    stats.totalTokens += tokensGenerated || 0;
    stats.totalLatency += latencyMs || 0;
    stats.lastSuccess = Date.now();
    stats.penalty = 0; // Reset penalty on success
    this.health.set(providerName, stats);
  }

  recordFailure(providerName) {
    const stats = this.health.get(providerName) || {
      successes: 0, failures: 0, totalTokens: 0, totalLatency: 0, lastSuccess: null, penalty: 0
    };
    stats.failures++;
    stats.penalty = Math.min(10, stats.penalty + 1); // Exponential penalty
    this.health.set(providerName, stats);
  }

  sortChain(chain) {
    if (!chain || chain.length <= 1) return chain || [];
    const self = this;
    return [...chain].sort(function(a, b) {
      const aStats = self.health.get(a.providerName);
      const bStats = self.health.get(b.providerName);
      const aScore = aStats ? (aStats.successes / (aStats.successes + aStats.failures + 1)) - (aStats.penalty * 0.1) : 0.5;
      const bScore = bStats ? (bStats.successes / (bStats.successes + bStats.failures + 1)) - (bStats.penalty * 0.1) : 0.5;
      return bScore - aScore;
    });
  }

  getStats() {
    const result = {};
    for (const [name, stats] of this.health) {
      result[name] = {
        successes: stats.successes,
        failures: stats.failures,
        successRate: stats.successes / (stats.successes + stats.failures + 1),
        avgLatency: stats.successes > 0 ? Math.round(stats.totalLatency / stats.successes) : 0,
        totalTokens: stats.totalTokens,
        penalty: stats.penalty
      };
    }
    return result;
  }
}

const mesh = new ProviderMesh();
export const providerMesh = mesh;
export default mesh;
