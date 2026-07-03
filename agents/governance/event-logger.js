import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// EVENT LOGGER — append-only صحيح
// الحل: hash يُحسب قبل INSERT — لا UPDATE أبداً
// العقلية 2: immutable event log
// ═══════════════════════════════════════════════════════════

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-32-chars-minimum!!';

export async function logEvent(eventType, agentId, customerId, payload) {
  try {
    // payload إلى نص ثابت الترتيب
    const payloadStr = JSON.stringify(payload, Object.keys(payload).sort());

    // حساب hash قبل INSERT — لا pending لا UPDATE
    const payloadHash = crypto
      .createHash('sha256')
      .update(payloadStr)
      .digest('hex');

    const signature = crypto
      .createHmac('sha256', ENCRYPTION_KEY)
      .update(payloadHash)
      .digest('hex');

    const ins = await pool.query(
      `INSERT INTO event_log 
       (event_type, agent_id, customer_id, payload, payload_hash, signature)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [eventType, agentId, customerId, payloadStr, payloadHash, signature]
    );

    const logId = ins.rows[0].id;

    // تحقق فعلي — القاعدة 5
    const verify = await pool.query(
      `SELECT id, payload_hash FROM event_log WHERE id=$1`, [logId]
    );

    if (verify.rows.length === 0) throw new Error('event_log_verify_failed');
    if (verify.rows[0].payload_hash !== payloadHash) throw new Error('hash_mismatch');

    return { success: true, id: logId, hash: payloadHash };
  } catch(e) {
    console.error('[event-logger]', e.message);
    return { success: false, error: e.message };
  }
}

export default { logEvent };
