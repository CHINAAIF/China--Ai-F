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

  async route({ task_type, customer_id, policy_version_id, agent_id, tenant_signature = null }) {
    const start = Date.now();
    const provider = await this.selectProvider({ task_type });
    if (!provider) return { success: false, error: 'NO_PROVIDER_AVAILABLE' };
    
    const latency_ms = Date.now() - start;
    const causal_reason = { selection_logic: 'deterministic_watchdog', score: provider.routing_meta.score };
    
    // Cryptographic Tenant Proof (Prevents Identity Spoofing)
    const immuneSecret = process.env.IMMUNE_SECRET;
    if (!immuneSecret) throw new Error('CRITICAL: IMMUNE_SECRET missing for Tenant Proof');
    const expectedSig = crypto.createHmac('sha256', immuneSecret).update(customer_id || 'system').digest('hex');
    
    if (tenant_signature !== expectedSig) {
      console.error('❌ [SECURITY] Tenant Spoofing Detected! Invalid signature for customer_id:', customer_id);
      return { success: false, error: 'Security Violation: Tenant Signature Invalid' };
    }

    const client = await pool.connect();
    try {
      const request_hash = crypto.createHash('sha256').update(JSON.stringify({task_type, ts:Date.now()})).digest('hex').slice(0,64);
      
      await client.query('BEGIN');
      // Use set_config (true = local to transaction) instead of SET LOCAL to avoid syntax errors
      await client.query("SELECT set_config('app.current_id', $1, true)", [customer_id || 'system']);
      
      await client.query(
        `INSERT INTO routing_decisions (customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id, agent_id, causal_reason, confidence, latency_ms, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'routed')`,
        [customer_id || 'system', request_hash, task_type, provider.slug, provider.id, policy_version_id, agent_id||this.name, JSON.stringify(causal_reason), provider.routing_meta.score, latency_ms]
      );
      await client.query('COMMIT');
    } catch(e) { 
      await client.query('ROLLBACK');
      console.error('❌ routing_decisions (RLS):', e.message); 
    } finally {
      client.release();
    }

    return { success: true, provider: { slug: provider.slug, name: provider.name, base_url: provider.base_url }, routing_id: null, causal_reason, latency_ms };
  }
}

export const tacticalRouter = new TacticalRouter();
export default tacticalRouter;
