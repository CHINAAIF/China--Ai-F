// TRUNKIA - Sovereign Firewall Agent - Fixed for local/remote compatibility
import { pool } from './db.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

export class SovereignFirewall {
  constructor() {
    this.name = 'sovereign-firewall';
    this.layer = 'security';
  }

  async analyzeAndAct({ requestId, threatScore }) {
    const action = this._determineAction(threatScore);
    // تسجيل الحدث بشكل آمن دون إيقاف الطلب
    this._logSecurityEvent({ requestId, threatScore, action }).catch(() => {});
    return { action, requestId };
  }

  _determineAction(threatScore) {
    if (threatScore >= 0.85) return 'block';
    if (threatScore >= 0.65) return 'restrict';
    if (threatScore >= 0.40) return 'warn';
    return 'allow';
  }

  async _logSecurityEvent({ requestId, threatScore, action }) {
    if (!pool) return; // لا يوجد اتصال بقاعدة البيانات (محلياً)
    try {
      const payload = JSON.stringify({ request_id: requestId, threat_score: threatScore, action });
      const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
      await pool.query(
        `INSERT INTO event_log (event_type, agent_id, payload, payload_hash, signature)
         VALUES ($1, $2, $3, $4, $5)`,
        [`security.containment.${action}`, this.name, payload, payloadHash, 'local']
      );
    } catch (e) {
      // فشل التسجيل لا يؤثر على الأمان
    }
  }
}

export const sovereignFirewall = new SovereignFirewall();
