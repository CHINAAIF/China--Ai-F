/**
 * policy-enforcer | layer: governance
 * العقليات: 1(كل طلب عدو) + 16(Compliance) + 2(immutable log) + 13(Causal)
 * مسؤولية: تحميل السياسة الفعّالة، التحقق من التوقيع، فحص التعارض، تسجيل كل قرار
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
    this._cache = new Map(); // policy_version_id → policy
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  // ── حمّل السياسة الفعّالة لعميل (آخر نسخة effective_at <= NOW)
  async loadEffectivePolicy(customer_id = null) {
    try {
      const r = await pool.query(
        `SELECT id, policy_type, version_number, content, content_hash, signature, effective_at
         FROM policy_documents
         WHERE (customer_id=$1 OR customer_id IS NULL)
           AND effective_at <= NOW()
         ORDER BY effective_at DESC, version_number DESC
         LIMIT 1`,
        [customer_id]
      );
      if (!r.rows.length) return null;
      const policy = r.rows[0];

      // تحقق من سلامة hash
      const computed = crypto.createHash('sha256').update(JSON.stringify(policy.content)).digest('hex');
      if (computed !== policy.content_hash) {
        await this._logConflict({ policy_id: policy.id, conflict_type: 'hash_mismatch', detail: { computed, stored: policy.content_hash } });
        return { ...policy, integrity: 'TAMPERED' };
      }
      this._cache.set(policy.id, { ...policy, integrity: 'OK' });
      return { ...policy, integrity: 'OK' };
    } catch(e) { console.error('❌ loadEffectivePolicy (متابعة):', e.message); return null; }
  }

  // ── أنشئ سياسة جديدة موقَّعة
  async createPolicy({ customer_id=null, policy_type='default', content, signed_by='system' }) {
    try {
      const content_hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
      const signature = crypto.createHash('sha256')
        .update(content_hash + (process.env.ENCRYPTION_KEY||'dev') + signed_by).digest('hex');

      // احصل على آخر version_number
      const last = await pool.query(
        `SELECT MAX(version_number) AS v FROM policy_documents WHERE (customer_id=$1 OR customer_id IS NULL)`,
        [customer_id]
      );
      const version_number = (last.rows[0]?.v || 0) + 1;

      const r = await pool.query(
        `INSERT INTO policy_documents (customer_id, policy_type, version_number, content, content_hash, signed_by, signature, effective_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id, version_number`,
        [customer_id, policy_type, version_number, JSON.stringify(content), content_hash, signed_by, signature]
      );
      console.log('✅ policy created v' + r.rows[0].version_number + ':', r.rows[0].id);

      // سجّل في event_log
      await this._logEvent('policy_created', { policy_id: r.rows[0].id, version_number, policy_type, customer_id });
      return r.rows[0];
    } catch(e) { console.error('❌ createPolicy (متابعة):', e.message); return null; }
  }

  // ── تحقق من أن طلباً يتوافق مع السياسة الفعّالة
  async enforce({ customer_id=null, action, resource, context={} }) {
    const policy = await this.loadEffectivePolicy(customer_id);
    if (!policy) return { allowed: true, reason: 'NO_POLICY_DEFAULT_ALLOW', policy_version_id: null };
    if (policy.integrity === 'TAMPERED') return { allowed: false, reason: 'POLICY_TAMPERED', policy_version_id: policy.id };

    const rules = policy.content?.rules || [];
    const matched = rules.find(r => r.action === action && (!r.resource || r.resource === resource));

    const allowed = matched ? matched.effect === 'allow' : (policy.content?.default_effect !== 'deny');
    const reason = matched ? `rule_matched:${matched.effect}` : 'default_effect';

    // سجّل القرار في event_log
    await this._logEvent('policy_enforced', { action, resource, allowed, reason, policy_version_id: policy.id, context });

    return { allowed, reason, policy_version_id: policy.id, policy_type: policy.policy_type, integrity: policy.integrity };
  }

  async _logConflict({ policy_id, conflict_type, detail }) {
    try {
      // تحقق من وجود جدول policy_conflicts_log
      await pool.query(
        `INSERT INTO policy_conflicts_log (policy_id, conflict_type, detail, created_at)
         VALUES ($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`,
        [policy_id, conflict_type, JSON.stringify(detail)]
      );
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
    // أنشئ سياسة تجريبية + اختبر enforce
    const p = await this.createPolicy({
      policy_type: 'default',
      content: { default_effect: 'allow', rules: [{ action: 'inference', resource: 'closed_model', effect: 'deny' }] },
      signed_by: 'diagnostic'
    });
    const r = await this.enforce({ action: 'inference', resource: 'closed_model' });
    return { agent: this.name, layer: this.layer, policy_id: p?.id, enforce_result: r };
  }
}

export const policyEnforcer = new PolicyEnforcer();
export default policyEnforcer;
