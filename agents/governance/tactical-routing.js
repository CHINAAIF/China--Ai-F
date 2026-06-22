/**
 * tactical-routing | layer: governance
 * قلب Governance Layer — يختار المزود + يسجل في routing_decisions + event_log
 * العقليات: 3(AI أداة) + 12(Router يوجّه) + 13(Causal) + 14(Temporal) + 18(Anomaly)
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class TacticalRouter {
  constructor() {
    this.name = 'tactical-routing';
    this.layer = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async selectProvider({ task_type, budget_usd, required_residency, prefer_open, quantization }) {
    try {
      const params = [];
      let q = `SELECT id, slug, name, provider_type, quantization_levels, data_residency, base_url
                FROM inference_providers WHERE status='active'`;
      if (required_residency) { params.push(JSON.stringify([required_residency])); q += ` AND data_residency @> $${params.length}::jsonb`; }
      if (prefer_open !== undefined) { params.push(prefer_open?'open':'closed'); q += ` AND provider_type=$${params.length}`; }
      const r = await pool.query(q, params);
      if (!r.rows.length) return null;

      const result = await safeGroqJSON(
        `Select best inference provider.
Task: ${task_type} | Budget/1k: ${budget_usd||'any'} | Quantization: ${quantization||'any'}
Providers: ${JSON.stringify(r.rows.map(p=>({slug:p.slug,type:p.provider_type,q:p.quantization_levels})))}
JSON: {"selected_slug":"...","reason":"...","confidence":85,"estimated_cost_usd":0.001}`
      );
      const selected = r.rows.find(p=>p.slug===result.data?.selected_slug) || r.rows[0];
      return { ...selected, routing_meta: result.data || {} };
    } catch(e) { console.error('❌ selectProvider (متابعة):', e.message); return null; }
  }

  async recordDecision({ provider, task_type, causal_reason, confidence, customer_id=null, policy_version_id=null, agent_id=null, latency_ms=0, cost_usd=0 }) {
    let routingId = null;
    try {
      const request_hash = crypto.createHash('sha256')
        .update(JSON.stringify({task_type, provider_id:provider?.id, ts:Date.now()})).digest('hex').slice(0,64);
      const r = await pool.query(
        `INSERT INTO routing_decisions
          (customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id,
           agent_id, causal_reason, confidence, latency_ms, cost_usd, outcome, outcome_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'routed',80) RETURNING id`,
        [customer_id, request_hash, task_type, provider?.slug||'unknown', provider?.id||null,
         policy_version_id, agent_id||this.name, JSON.stringify(causal_reason),
         Math.round(confidence||80), latency_ms, cost_usd]
      );
      routingId = r.rows[0].id;
      console.log('✅ routing_decisions:', routingId);
    } catch(e) { console.error('❌ routing_decisions (متابعة):', e.message); }

    try {
      const payload = { routing_id:routingId, task_type, provider:provider?.slug, causal_reason };
      const payload_hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const signature = crypto.createHash('sha256')
        .update(payload_hash+(process.env.ENCRYPTION_KEY||'dev')).digest('hex');
      await pool.query(
        `INSERT INTO event_log (event_type, agent_id, customer_id, policy_version_id, payload, payload_hash, signature)
         VALUES ('routing_decision',$1,$2,$3,$4,$5,$6)`,
        [this.name, customer_id, policy_version_id, JSON.stringify(payload), payload_hash, signature]
      );
      console.log('✅ event_log written');
    } catch(e) { console.error('❌ event_log (متابعة):', e.message); }
    return routingId;
  }

  async route({ task_type, budget_usd, required_residency, prefer_open, quantization, customer_id, policy_version_id, agent_id }) {
    const start = Date.now();
    const provider = await this.selectProvider({ task_type, budget_usd, required_residency, prefer_open, quantization });
    if (!provider) return { success:false, error:'NO_PROVIDER_AVAILABLE' };
    const latency_ms = Date.now()-start;
    const causal_reason = { selection_logic:'groq_scored', task_type, filters:{required_residency,prefer_open,quantization}, meta:provider.routing_meta||{} };
    const routingId = await this.recordDecision({ provider, task_type, causal_reason, confidence:provider.routing_meta?.confidence||80, customer_id, policy_version_id, agent_id, latency_ms, cost_usd:provider.routing_meta?.estimated_cost_usd||0 });
    return { success:true, provider:{slug:provider.slug,name:provider.name,base_url:provider.base_url}, routing_id:routingId, causal_reason, latency_ms };
  }

  async runDiagnostic() {
    const r = await this.route({ task_type:'text_generation', prefer_open:true, agent_id:'diagnostic' });
    return { agent:this.name, layer:this.layer, status:r.success?'ok':'error', ...r };
  }
}

export const tacticalRouter = new TacticalRouter();
export default tacticalRouter;
