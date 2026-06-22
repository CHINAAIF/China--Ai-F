/**
 * replay-guard | layer: governance
 * العقلية 19: كل nonce مستخدم يُسجَّل ويُرفض إعادة استخدامه
 * العقلية 1: كل طلب عدو حتى يثبت العكس
 * العقلية 2: immutable event_log — لا DELETE
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const WINDOW_SECONDS = 30; // نافذة صلاحية الـcontract

class ReplayGuard {
  constructor() {
    this.name = 'replay-guard';
    this.layer = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  // ── أنشئ contract موقَّع بـnonce فريد
  async createContract({ customer_id=null, policy_version_id=null, payload={} }) {
    try {
      const nonce = crypto.randomBytes(32).toString('hex');
      const valid_until = new Date(Date.now() + WINDOW_SECONDS * 1000);
      const content_hash = crypto.createHash('sha256')
        .update(JSON.stringify({ nonce, customer_id, payload, valid_until })).digest('hex');
      const signature = crypto.createHash('sha256')
        .update(content_hash + (process.env.ENCRYPTION_KEY||'dev')).digest('hex');

      const r = await pool.query(
        `INSERT INTO governance_contracts (nonce, customer_id, policy_version_id, content_hash, signature, valid_until, used)
         VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id, nonce, valid_until`,
        [nonce, customer_id, policy_version_id, content_hash, signature, valid_until]
      );
      console.log('✅ contract created:', r.rows[0].id);
      await this._logEvent('contract_created', { contract_id: r.rows[0].id, nonce: nonce.slice(0,8)+'...', valid_until });
      return { id: r.rows[0].id, nonce, valid_until, content_hash, signature };
    } catch(e) { console.error('❌ createContract (متابعة):', e.message); return null; }
  }

  // ── تحقق من contract: nonce فريد + لم يُستخدم + لم تنته صلاحيته + signature سليم
  async verifyAndConsume({ contract_id, nonce, signature }) {
    try {
      // جلب contract
      const r = await pool.query(
        `SELECT id, nonce, content_hash, signature, valid_until, used, used_at
         FROM governance_contracts WHERE id=$1`,
        [contract_id]
      );
      if (!r.rows.length) return { valid: false, reason: 'CONTRACT_NOT_FOUND' };
      const contract = r.rows[0];

      // 1. تحقق nonce يطابق
      if (contract.nonce !== nonce) return { valid: false, reason: 'NONCE_MISMATCH' };

      // 2. تحقق لم يُستخدم
      if (contract.used) {
        await this._logEvent('replay_attempt', { contract_id, nonce: nonce.slice(0,8)+'...', used_at: contract.used_at });
        return { valid: false, reason: 'REPLAY_DETECTED', used_at: contract.used_at };
      }

      // 3. تحقق الصلاحية الزمنية
      if (new Date() > new Date(contract.valid_until)) {
        await this._logEvent('contract_expired', { contract_id, valid_until: contract.valid_until });
        return { valid: false, reason: 'CONTRACT_EXPIRED', valid_until: contract.valid_until };
      }

      // 4. تحقق signature
      const recomputed = crypto.createHash('sha256')
        .update(contract.content_hash + (process.env.ENCRYPTION_KEY||'dev')).digest('hex');
      if (recomputed !== signature) {
        await this._logEvent('signature_invalid', { contract_id });
        return { valid: false, reason: 'SIGNATURE_INVALID' };
      }

      // 5. استهلك — mark as used (مرة واحدة فقط، atomic)
      const consumed = await pool.query(
        `UPDATE governance_contracts SET used=true, used_at=NOW()
         WHERE id=$1 AND used=false RETURNING id`,
        [contract_id]
      );
      if (!consumed.rows.length) {
        await this._logEvent('replay_attempt', { contract_id, reason: 'race_condition' });
        return { valid: false, reason: 'REPLAY_DETECTED_RACE' };
      }

      // سجّل في nonce_registry
      await this._registerNonce(nonce, contract_id);
      await this._logEvent('contract_consumed', { contract_id, nonce: nonce.slice(0,8)+'...' });

      return { valid: true, contract_id, reason: 'OK' };
    } catch(e) { console.error('❌ verifyAndConsume (متابعة):', e.message); return { valid: false, reason: 'ERROR', error: e.message }; }
  }

  async _registerNonce(nonce, contract_id) {
    try {
      await pool.query(
        `INSERT INTO nonce_registry (nonce, contract_id, created_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING`,
        [nonce, contract_id]
      );
    } catch(e) { console.warn('⚠️ nonce_registry (متابعة):', e.message); }
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
    // أنشئ contract
    const c = await this.createContract({ payload: { test: true } });
    if (!c) return { agent: this.name, status: 'error', reason: 'CREATE_FAILED' };

    // استخدمه مرة أولى — يجب أن ينجح
    const r1 = await this.verifyAndConsume({ contract_id: c.id, nonce: c.nonce, signature: c.signature });
    // استخدمه مرة ثانية — يجب أن يُرفض كـReplay
    const r2 = await this.verifyAndConsume({ contract_id: c.id, nonce: c.nonce, signature: c.signature });

    return { agent: this.name, layer: this.layer, first_use: r1, replay_attempt: r2 };
  }
}

export const replayGuard = new ReplayGuard();
export default replayGuard;
