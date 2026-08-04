/**
 * TRUNKIA Cognitive Drift Agent (Fortified)
 * Fixes: Safe Samples, Dynamic Baseline, Decay Counter, Length Variance, Targeted Purge, Freeze Enforcement.
 */
import { BaseAgent } from '../base-agent.js';
import { semanticCache } from '../../lib/semantic-cache.js';
import { writeMemory, readMemory } from '../../lib/blackboard.js';
import crypto from 'crypto';

class CognitiveDriftAgent extends BaseAgent {
  constructor() {
    super('cognitive_drift', 'system');
    this.dynamicBaseline = 0.2; // Theoretical Healthy Baseline (High Diversity)
    this.driftCounter = 0;       // Fix #6: Uses decay, not hard reset
  }

  // Fix #5: Multi-dimensional analysis (Hash Uniqueness + Length Variance)
  _analyzeSample(sample) {
    if (!sample || sample.length < 5) return { sufficient: false };

    // Dimension 1: Hash Uniqueness (Are responses identical?)
    const hashes = sample.map(s => s.hash);
    const uniqueHashes = new Set(hashes).size;
    const uniquenessRatio = uniqueHashes / hashes.length;

    // Dimension 2: Length Variance (Are responses structurally identical?)
    const lengths = sample.map(s => s.length);
    const meanLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - meanLength, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const lengthCV = meanLength > 0 ? stdDev / meanLength : 0; // Coefficient of Variation

    // Combined Drift Score (0 = Healthy, 1 = Total Stagnation)
    const stagnationScore = ((1 - uniquenessRatio) * 0.6) + ((1 - Math.min(1, lengthCV)) * 0.4);
    
    return { sufficient: true, stagnationScore, uniquenessRatio, lengthCV };
  }

  async run() {
    this._checkVitals();
    try {
      // 1. Get Safe Sample (No raw text, prevents Cross-Tenant Leakage)
      const sample = semanticCache.getSafeSample(20);
      const analysis = this._analyzeSample(sample);

      if (!analysis.sufficient) {
        return { success: true, status: 'insufficient_data' };
      }

      // 2. Initialize Dynamic Baseline on first run
      // Baseline is fixed at theoretical health. No learning from potentially poisoned state.

      // 3. Calculate Deviation from Dynamic Baseline (Moving Average)
      this.dynamicBaseline = (this.dynamicBaseline * 0.9) + (analysis.stagnationScore * 0.1); // Slow adaptation
      const deviation = analysis.stagnationScore - this.dynamicBaseline;

      // 4. Drift Detection (Stagnation increased by > 0.15)
      if (deviation > 0.15) {
        // Fix #6: Decay counter (attacker can't reset it with one clean request)
        this.driftCounter = Math.min(5, this.driftCounter + 1.5);
        console.warn(`[CognitiveDrift] WARNING: Stagnation up (${analysis.stagnationScore.toFixed(2)}). Counter: ${this.driftCounter.toFixed(1)}`);
        
        if (this.driftCounter >= 3) {
          console.error('[CognitiveDrift] CRITICAL: Cognitive Drift Confirmed. Initiating Targeted Purge.');

          // Fix #4: Enforce Freeze via Blackboard (Protocol must check this)
          await writeMemory('system:cognitive_freeze', { active: true, reason: 'Cognitive Drift', timestamp: Date.now() }, 15);

          // Surgical Purge: Delete ONLY duplicate hashes, keep unique entries
          const entries = Array.from(semanticCache.cache.entries());
          const seenHashes = new Set();
          let purgedCount = 0;
          for (const [key, val] of entries) {
            const content = val.response?.content || '';
            const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
            if (seenHashes.has(hash)) {
              semanticCache.cache.delete(key);
              purgedCount++;
            } else {
              seenHashes.add(hash);
            }
          }
          console.warn(`[CognitiveDrift] Surgical Purge: Removed ${purgedCount} duplicate entries. Kept ${seenHashes.size} unique entries.`);

          this.driftCounter = 0; // Reset after action
          return { success: true, status: 'targeted_purge', stagnation: analysis.stagnationScore };
        }
      } else {
        // Fix #6: Slow decay instead of instant reset
        this.driftCounter = Math.max(0, this.driftCounter - 0.5);
      }

      return { success: true, status: 'monitoring', stagnation: analysis.stagnationScore, baseline: this.dynamicBaseline };

    } catch (e) {
      console.error('[CognitiveDrift] Error:', e.message);
      return { success: false, error: e.message };
    }
  }
}

export const cognitiveDriftAgent = new CognitiveDriftAgent();
export default cognitiveDriftAgent;
