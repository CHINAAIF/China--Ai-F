import { logExecution, safeStep } from '../utils/executor.js';
/**
 * replay-guard | layer: governance
 * العقلية 19: كل nonce مستخدم يُسجَّل ويُرفض إعادة استخدامه
 * nonce_registry أعمدة: nonce, agent_id, customer_id, used_at, expires_at, rejected
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
const WINDOW_SECONDS = 30;

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
      await this._logEvent('contract_created', { contract_id: r.rows[0].id, valid_until });
      return { id: r.rows[0].id, nonce, valid_until, content_hash, signature };
    } catch(e) { console.error('❌ createContract (متابعة):', e.message); return null; }
  }

  async verifyAndConsume({ contract_id, nonce, signature }) {
    try {
      const r = await pool.query(
        `SELECT id, nonce, content_hash, signature, valid_until, used, used_at
         FROM governance_contracts WHERE id=$1`,
        [contract_id]
      );
      if (!r.rows.length) return { valid: false, reason: 'CONTRACT_NOT_FOUND' };
      const c = r.rows[0];

      if (c.nonce !== nonce) return { valid: false, reason: 'NONCE_MISMATCH' };

      if (c.used) {
        await this._logEvent('replay_attempt', { contract_id, used_at: c.used_at });
        return { valid: false, reason: 'REPLAY_DETECTED', used_at: c.used_at };
      }

      if (new Date() > new Date(c.valid_until)) {
        await this._logEvent('contract_expired', { contract_id, valid_until: c.valid_until });
        return { valid: false, reason: 'CONTRACT_EXPIRED' };
      }

      const recomputed = crypto.createHash('sha256')
        .update(c.content_hash + (process.env.ENCRYPTION_KEY||'dev')).digest('hex');
      if (recomputed !== signature) {
        await this._logEvent('signature_invalid', { contract_id });
        return { valid: false, reason: 'SIGNATURE_INVALID' };
      }

      const consumed = await pool.query(
        `UPDATE governance_contracts SET used=true, used_at=NOW()
         WHERE id=$1 AND used=false RETURNING id`,
        [contract_id]
      );
      if (!consumed.rows.length) {
        await this._logEvent('replay_attempt', { contract_id, reason: 'race_condition' });
        return { valid: false, reason: 'REPLAY_DETECTED_RACE' };
      }

      // سجّل في nonce_registry بالأعمدة الفعلية
      await this._registerNonce(nonce);
      await this._logEvent('contract_consumed', { contract_id });
      return { valid: true, contract_id, reason: 'OK' };
    } catch(e) { console.error('❌ verifyAndConsume (متابعة):', e.message); return { valid: false, reason: 'ERROR', error: e.message }; }
  }

  async _registerNonce(nonce) {
    try {
      const expires_at = new Date(Date.now() + WINDOW_SECONDS * 1000);
      await pool.query(
        `INSERT INTO nonce_registry (nonce, agent_id, used_at, expires_at, rejected)
         VALUES ($1,$2,NOW(),$3,false) ON CONFLICT (nonce) DO NOTHING`,
        [nonce, this.name, expires_at]
      );
      console.log('✅ nonce_registry written');
    } catch(e) { console.warn('⚠️ nonce_registry (متابعة):', e.message); }
  }

  async _logEvent(event_type, payload) {
    try {
      const payload_hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const sig = crypto.createHash('sha256')
        .update(payload_hash+(process.env.ENCRYPTION_KEY||'dev')).digest('hex');
      await pool.query(
        `INSERT INTO event_log (event_type, agent_id, payload, payload_hash, signature)
         VALUES ($1,$2,$3,$4,$5)`,
        [event_type, this.name, JSON.stringify(payload), payload_hash, sig]
      );
    } catch(e) { console.warn('⚠️ event_log (متابعة):', e.message); }
  }

  async runDiagnostic() {
    const c = await this.createContract({ payload: { test: true } });
    if (!c) return { agent: this.name, status: 'error' };
    const r1 = await this.verifyAndConsume({ contract_id: c.id, nonce: c.nonce, signature: c.signature });
    const r2 = await this.verifyAndConsume({ contract_id: c.id, nonce: c.nonce, signature: c.signature });
    return { agent: this.name, layer: this.layer, first_use: r1, replay_attempt: r2 };
  }
}

export const replayGuard = new ReplayGuard();
export default replayGuard;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'replay-guard', status: 'ok' } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
