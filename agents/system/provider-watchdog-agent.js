/**
 * TRUNKIA Provider Watchdog Agent
 * Monitors provider health (Latency, Failures, Circuit State) and calculates a deterministic Trust Score.
 */
import { BaseAgent } from '../base-agent.js';
import { multiModel } from '../governance/multi-model.js';
import { writeMemory, readMemory, generateMemoryToken } from '../../lib/blackboard.js';

class ProviderWatchdogAgent extends BaseAgent {
  constructor() {
    super('provider_watchdog', 'system');
    this.watchdogToken = generateMemoryToken('provider_watchdog');
  }

  _calculateScore(provider) {
    let score = 100;
    // Penalize open circuits heavily
    if (provider.circuit_open) score -= 50;
    // Penalize failures
    score -= (provider.failures * 10);
    // Penalize high latency (normalize: 1000ms = -10 points)
    score -= Math.floor(provider.avg_latency_ms / 100);
    // Reward configuration
    if (provider.configured) score += 10;
    
    return Math.max(0, Math.min(100, score));
  }

  async run() {
    this._checkVitals();
    try {
      const healthStatus = multiModel.getHealthStatus();
      const trustLedger = {};

      for (const p of healthStatus) {
        trustLedger[p.name] = {
          score: this._calculateScore(p),
          available: p.available,
          latency: p.avg_latency_ms,
          failures: p.failures
        };
      }

      // Write to Blackboard for Tactical Router to consume
      await writeMemory('system:provider_trust_ledger', trustLedger, 60, this.watchdogToken);
      
      return { success: true, ledger: trustLedger };
    } catch (e) {
      console.error('[Watchdog] Error:', e.message);
      return { success: false, error: e.message };
    }
  }
}

export const providerWatchdogAgent = new ProviderWatchdogAgent();
export default providerWatchdogAgent;
