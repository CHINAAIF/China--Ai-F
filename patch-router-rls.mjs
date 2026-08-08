import fs from 'fs';
const f = 'agents/governance/tactical-routing.js';
let c = fs.readFileSync(f, 'utf8');

const oldRouteFunc = `  async route({ task_type, customer_id, policy_version_id, agent_id }) {
    const start = Date.now();
    const provider = await this.selectProvider({ task_type });
    if (!provider) return { success: false, error: 'NO_PROVIDER_AVAILABLE' };
    
    const latency_ms = Date.now() - start;
    const causal_reason = { selection_logic: 'deterministic_watchdog', score: provider.routing_meta.score };
    
    // Record decision deterministically
    try {
      const request_hash = crypto.createHash('sha256').update(JSON.stringify({task_type, ts:Date.now()})).digest('hex').slice(0,64);
      await pool.query(
        \`INSERT INTO routing_decisions (customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id, agent_id, causal_reason, confidence, latency_ms, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'routed')\`,
        [customer_id, request_hash, task_type, provider.slug, provider.id, policy_version_id, agent_id||this.name, JSON.stringify(causal_reason), provider.routing_meta.score, latency_ms]
      );
    } catch(e) { console.error('❌ routing_decisions:', e.message); }

    return { success: true, provider: { slug: provider.slug, name: provider.name, base_url: provider.base_url }, routing_id: null, causal_reason, latency_ms };
  }`;

const newRouteFunc = `  async route({ task_type, customer_id, policy_version_id, agent_id }) {
    const start = Date.now();
    const provider = await this.selectProvider({ task_type });
    if (!provider) return { success: false, error: 'NO_PROVIDER_AVAILABLE' };
    
    const latency_ms = Date.now() - start;
    const causal_reason = { selection_logic: 'deterministic_watchdog', score: provider.routing_meta.score };
    
    // Record decision with RLS Compliance (Tenant Isolation)
    const client = await pool.connect();
    try {
      const request_hash = crypto.createHash('sha256').update(JSON.stringify({task_type, ts:Date.now()})).digest('hex').slice(0,64);
      
      await client.query('BEGIN');
      // Satisfy strict_isolation_policy: Set tenant context before any write
      await client.query("SET LOCAL app.current_id = $1", [customer_id || 'system']);
      
      await client.query(
        \`INSERT INTO routing_decisions (customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id, agent_id, causal_reason, confidence, latency_ms, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'routed')\`,
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
  }`;

if (c.includes(oldRouteFunc)) {
  c = c.replace(oldRouteFunc, newRouteFunc);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched tactical-routing.js (RLS Compliant Writes)');
} else {
  console.log('❌ Could not find old route function.');
}
