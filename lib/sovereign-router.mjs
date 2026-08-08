/**
 * TRUNKIA Cognitive Aware Router (v2.0)
 * Upgraded by 200 Experts: Health-Aware, Auto-Escalation, Temporal Load Balancing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readMemory } from './blackboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let providersConfig = [];
try {
  const configPath = path.resolve(__dirname, '../config/inference-providers.json');
  providersConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')).providers;
} catch (e) {
  console.error('[CognitiveRouter] FATAL: Could not load providers.');
}

const lastUsedMap = new Map();

export async function getRoutingChain(requestedTier) {
  const trustLedger = await readMemory('system:provider_trust_ledger') || {};
  const tiers = ['lite', 'standard', 'heavy'];
  const startIdx = tiers.indexOf(requestedTier);

  for (let i = startIdx; i < tiers.length; i++) {
    const currentTier = tiers[i];
    const candidates = [];

    for (const p of providersConfig) {
      const apiKey = process.env[p.envKey];
      if (apiKey || p.envKey === 'OLLAMA_ENABLED') {
        const modelName = p.models[currentTier];
        if (modelName) {
          const health = trustLedger[p.name] || { score: 50, available: true };
          if (health.available && health.score > 30) {
            candidates.push({
              providerName: p.name,
              baseURL: p.baseURL,
              apiKey: apiKey,
              modelName: modelName,
              priority: p.priority,
              trustScore: health.score,
              lastUsed: lastUsedMap.get(p.name) || 0
            });
          }
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.lastUsed - b.lastUsed;
      });

      lastUsedMap.set(candidates[0].providerName, Date.now());
      return candidates;
    }
  }
  return [];
}

export default { getRoutingChain };
