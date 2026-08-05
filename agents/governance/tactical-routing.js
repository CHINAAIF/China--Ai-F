import { getPool, generateDbToken } from '../../lib/db.js';
import { readMemory, generateMemoryToken } from '../../lib/blackboard.js';
import crypto from 'crypto';

const pool = getPool('governance', generateDbToken('agents/governance/tactical-routing.js'));
const routerToken = generateMemoryToken('orchestrator'); // Router acts under orchestrator authority for reads

class TacticalRouter {
  constructor() {
    this.name = 'tactical-routing';
    this.layer = 'governance';
  }

  // Deterministic Routing: Reads Trust Ledger from Blackboard and picks the best provider mathematically.
  async selectProvider({ task_type, required_residency, prefer_open }) {
    try {
      // 1. Read Trust Ledger from Watchdog
      const ledger = await readMemory('system:provider_trust_ledger') || {};
      
      // 2. Get active providers from DB
      const q = `SELECT slug, name, base_url FROM inference_providers WHERE status='active'`;
      const r = await pool.query(q);
      if (!r.rows.length) return null;

      // 3. Math-based Selection
      let bestProvider = null;
      let highestScore = -1;

      for (const row of r.rows) {
        const trustData = ledger[row.slug];
        // If no watchdog data, assume neutral score (50)
        const score = trustData ? trustData.score : 50; 
        const isAvailable = trustData ? trustData.available : true;

        if (isAvailable && score > highestScore) {
          highestScore = score;
          bestProvider = row;
        }
      }

      if (!bestProvider) return null;
      return { ...bestProvider, routing_meta: { score: highestScore, logic: 'deterministic_trust' } };
    } catch(e) { 
      console.error('❌ selectProvider:', e.message); 
      return null; 
    }
  }

  async route({ task_type, customer_id, policy_version_id, agent_id }) {
    const start = Date.now();
    const provider = await this.selectProvider({ task_type });
    if (!provider) return { success: false, error: 'NO_PROVIDER_AVAILABLE' };
    
    const latency_ms = Date.now() - start;
    const causal_reason = { selection_logic: 'deterministic_watchdog', score: provider.routing_meta.score };
    
    // Record decision deterministically
    try {
      const request_hash = crypto.createHash('sha256').update(JSON.stringify({task_type, ts:Date.now()})).digest('hex').slice(0,64);
      await pool.query(
        `INSERT INTO routing_decisions (customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id, agent_id, causal_reason, confidence, latency_ms, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'routed')`,
        [customer_id, request_hash, task_type, provider.slug, provider.id, policy_version_id, agent_id||this.name, JSON.stringify(causal_reason), provider.routing_meta.score, latency_ms]
      );
    } catch(e) { console.error('❌ routing_decisions:', e.message); }

    return { success: true, provider: { slug: provider.slug, name: provider.name, base_url: provider.base_url }, routing_id: null, causal_reason, latency_ms };
  }
}

export const tacticalRouter = new TacticalRouter();
export default tacticalRouter;
