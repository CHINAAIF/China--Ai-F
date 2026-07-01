// TRUNKIA - Sovereign Firewall Agent - Unified Local/Remote
// يعمل بكامل طاقته في الإنتاج، وفي وضع "الحماية الأساسية" محلياً
import { pool } from './db.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

export class SovereignFirewall {
  constructor() {
    this.name = 'sovereign-firewall';
    this.layer = 'security';
  }

  async analyzeAndAct({ requestId, threatScore }) {
    const action = this._determineAction(threatScore);
    // تسجيل الحدث بشكل آمن - في الإنتاج فقط
    if (isProduction) {
      this._logSecurityEvent({ requestId, threatScore, action }).catch(() => {});
    } else {
      console.log(`[FIREWALL LOCAL] Action: ${action} | Threat: ${threatScore?.toFixed(2)} | Req: ${requestId}`);
    }
    return { action, requestId };
  }

  _determineAction(threatScore) {
    if (typeof threatScore !== 'number' || threatScore < 0 || threatScore > 1) return 'allow';
    if (threatScore >= 0.85) return 'block';
    if (threatScore >= 0.65) return 'restrict';
    if (threatScore >= 0.40) return 'warn';
    return 'allow';
  }

  async _logSecurityEvent({ requestId, threatScore, action }) {
    if (!pool) return;
    try {
      const payload = JSON.stringify({ request_id: requestId, threat_score: threatScore, action });
      const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
      const signature = ENCRYPTION_KEY
        ? crypto.createHash('sha256').update(payloadHash + ENCRYPTION_KEY).digest('hex')
        : 'unsigned';
      await pool.query(
        `INSERT INTO event_log (event_type, agent_id, payload, payload_hash, signature)
         VALUES ($1, $2, $3, $4, $5)`,
        [`security.containment.${action}`, this.name, payload, payloadHash, signature]
      );
    } catch (e) {
      console.error(`[FIREWALL] DB log failed: ${e.message}`);
    }
  }
}

export const sovereignFirewall = new SovereignFirewall();
