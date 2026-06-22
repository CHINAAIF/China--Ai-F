/**
 * policy-enforcer | layer: governance
 * FIX: content::text لضمان hash صحيح + resolution في conflict_log
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class PolicyEnforcer {
  constructor() {
    this.name = 'policy-enforcer';
    this.layer = 'governance';
    this.status = 'active';
    this._cache = new Map();
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async loadEffectivePolicy(customer_id = null) {
    try {
      // content::text — نص خام كما خُزِّن، لضمان hash صحيح
      const r = await pool.query(
        `SELECT id, policy_type, version_number, content::text AS content_raw,
                content, content_hash, signature, effective_at
         FROM policy_documents
         WHERE (customer_id=$1 OR customer_id IS NULL) AND effective_at <= NOW()
         ORDER BY effective_at DESC, version_number DESC LIMIT 1`,
        [customer_id]
      );
      if (!r.rows.length) return null;
      const policy = r.rows[0];

      // hash على النص الخام كما خُزِّن
      const computed = crypto.createHash('sha256').update(policy.content_raw).digest('hex');
      if (computed !== policy.content_hash) {
        console.warn(`⚠️ TAMPERED: ${policy.id}`);
        await this._logConflict({ policy_a_id: policy.id, conflict_type: 'hash_mismatch', context: { computed, stored: policy.content_hash } });
        return { ...policy, integrity: 'TAMPERED' };
      }
      const cached = { ...policy, integrity: 'OK' };
      this._cache.set(policy.id, cached);
      return cached;
    } catch(e) { console.error('❌ loadEffectivePolicy (متابعة):', e.message); return null; }
  }

  async createPolicy({ customer_id=null, policy_type='default', content, signed_by='system' }) {
    try {
      const contentStr = JSON.stringify(content);
      const content_hash = crypto.createHash('sha256').update(contentStr).digest('hex');
      const signature = crypto.createHash('sha256')
        .update(content_hash+(process.env.ENCRYPTION_KEY||'dev')+signed_by).digest('hex');

      const last = await pool.query(
        `SELECT MAX(version_number) AS v FROM policy_documents WHERE (customer_id=$1 OR customer_id IS NULL)`,
        [customer_id]
      );
      const version_number = (last.rows[0]?.v || 0) + 1;

      const r = await pool.query(
        `INSERT INTO policy_documents (customer_id, policy_type, version_number, content, content_hash, signed_by, signature, effective_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,NOW()) RETURNING id, version_number`,
        [customer_id, policy_type, version_number, contentStr, content_hash, signed_by, signature]
      );

      // تحقق فوري: هل hash يطابق بعد INSERT
      const verify = await pool.query(
        `SELECT content::text AS raw, content_hash FROM policy_documents WHERE id=$1`,
        [r.rows[0].id]
      );
      const recomputed = crypto.createHash('sha256').update(verify.rows[0].raw).digest('hex');
      if (recomputed !== verify.rows[0].content_hash) {
        console.error(`❌ POST_INSERT hash mismatch! id=${r.rows[0].id}`);
      } else {
        console.log('✅ policy created + hash verified v'+r.rows[0].version_number);
      }

      await this._logEvent('policy_created', { policy_id: r.rows[0].id, version_number, policy_type });
      return r.rows[0];
    } catch(e) { console.error('❌ createPolicy (متابعة):', e.message); return null; }
  }

  async enforce({ customer_id=null, action, resource, context={} }) {
    const policy = await this.loadEffectivePolicy(customer_id);
    if (!policy) return { allowed: true, reason: 'NO_POLICY_DEFAULT_ALLOW', policy_version_id: null };
    if (policy.integrity === 'TAMPERED') return { allowed: false, reason: 'POLICY_TAMPERED', policy_version_id: policy.id };

    const rules = policy.content?.rules || [];
    const matched = rules.find(r => r.action===action && (!r.resource||r.resource===resource));
    const allowed = matched ? matched.effect==='allow' : (policy.content?.default_effect!=='deny');
    const reason = matched ? `rule_matched:${matched.effect}` : 'default_effect';

    await this._logEvent('policy_enforced', { action, resource, allowed, reason, policy_version_id: policy.id, context });
    return { allowed, reason, policy_version_id: policy.id, integrity: policy.integrity };
  }

  async _logConflict({ policy_a_id, policy_b_id=null, conflict_type, context={} }) {
    try {
      await pool.query(
        `INSERT INTO policy_conflicts_log (policy_a_id, policy_b_id, conflict_type, resolution, context, created_at)
         VALUES ($1,$2,$3,'pending_review',$4,NOW())`,
        [policy_a_id, policy_b_id, conflict_type, JSON.stringify(context)]
      );
      console.log('✅ conflict_log written');
    } catch(e) { console.warn('⚠️ conflict_log (متابعة):', e.message); }
  }

  async _logEvent(event_type, payload) {
    try {
      const payload_hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const signature = crypto.createHash('sha256')
        .update(payload_hash+(process.env.ENCRYPTION_KEY||'dev')).digest('hex');
      await pool.query(
        `INSERT INTO event_log (event_type, agent_id, payload, payload_hash, signature)
         VALUES ($1,$2,$3,$4,$5)`,
        [event_type, this.name, JSON.stringify(payload), payload_hash, signature]
      );
    } catch(e) { console.warn('⚠️ event_log (متابعة):', e.message); }
  }

  async runDiagnostic() {
    const p = await this.createPolicy({
      policy_type: 'default',
      content: { default_effect: 'allow', rules: [{ action:'inference', resource:'closed_model', effect:'deny' }] },
      signed_by: 'diagnostic'
    });
    const r1 = await this.enforce({ action:'inference', resource:'closed_model' });
    const r2 = await this.enforce({ action:'inference', resource:'open_model' });
    return { agent: this.name, layer: this.layer, policy_id: p?.id, deny_test: r1, allow_test: r2 };
  }
}

export const policyEnforcer = new PolicyEnforcer();
export default policyEnforcer;
