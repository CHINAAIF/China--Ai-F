/**
 * TRUNKIA Shadow Router
 * Connects Cognitive Intent to Provider Failover Chains.
 * Does not expose provider names to the upstream system.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let providersConfig = [];
try {
  const configPath = path.resolve(__dirname, '../config/inference-providers.json');
  providersConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')).providers;
} catch (e) {
  console.error('[ShadowRouter] FATAL: Could not load providers.');
}

// Build a map of Tier -> Array of {providerName, client, modelName, priority}
const tierMap = { lite: [], standard: [], heavy: [] };

providersConfig.forEach(p => {
  const apiKey = process.env[p.envKey];
  // Only register if API key is present (or it's local ollama which might just need a boolean)
  if (apiKey || p.envKey === 'OLLAMA_ENABLED') {
    // Dynamically import OpenAI to avoid circular deps if needed, or assume it's passed
    // For simplicity here, we just store the config, the gateway will instantiate the client
    for (const tier of ['lite', 'standard', 'heavy']) {
      if (p.models[tier]) {
        tierMap[tier].push({
          providerName: p.name,
          baseURL: p.baseURL,
          apiKey: apiKey,
          modelName: p.models[tier],
          priority: p.priority
        });
      }
    }
  }
});

// Sort each tier by priority (1 is highest)
for (const tier of Object.keys(tierMap)) {
  tierMap[tier].sort((a, b) => a.priority - b.priority);
}

export function getRoutingChain(tier) {
  // Returns the ordered list of providers for the given tier
  // If no providers for specific tier, fallback to standard
  return tierMap[tier] || tierMap['standard'];
}

export default { getRoutingChain };
