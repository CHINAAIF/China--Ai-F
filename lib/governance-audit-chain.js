import crypto from 'crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: true });

const HMAC_SECRET = process.env.GOVERNANCE_HMAC_SECRET;
if (!HMAC_SECRET) {
  throw new Error('[GovernanceAuditChain] FATAL: GOVERNANCE_HMAC_SECRET is not set.');
}

const CHAIN_LOCK_ID = 918273645;

function computeSHA256(data) { return crypto.createHash('sha256').update(data, 'utf8').digest('hex'); }
function computeHMAC(data) { return crypto.createHmac('sha256', HMAC_SECRET).update(data, 'utf8').digest('hex'); }

export async function logGovernanceEvent(eventType, tableName, details = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [CHAIN_LOCK_ID]);

    const lastRes = await client.query('SELECT current_hash FROM governance_audit_chain ORDER BY id DESC LIMIT 1');
    const previousHash = lastRes.rows.length > 0 ? lastRes.rows[0].current_hash : null;

    const payload = { event_type: eventType, table_name: tableName, details: details, timestamp: new Date().toISOString() };
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());

    const currentHash = computeSHA256(payloadString);
    const hmacSignature = computeHMAC(currentHash);

    const result = await client.query(
      `INSERT INTO governance_audit_chain (previous_hash, current_hash, hmac_signature, event_type, table_name, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, current_hash`,
      [previousHash, currentHash, hmacSignature, eventType, tableName, details]
    );

    await client.query('COMMIT');
    return { success: true, id: result.rows[0].id, current_hash: currentHash, previous_hash: previousHash };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[GovernanceAuditChain] Error logging event:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function verifyGovernanceChainIntegrity() {
  try {
    const result = await pool.query('SELECT id, previous_hash, current_hash, hmac_signature, created_at FROM governance_audit_chain ORDER BY id ASC');
    let previousHash = null;
    let isValid = true;
    const errors = [];
    for (const row of result.rows) {
      const expectedHMAC = computeHMAC(row.current_hash);
      if (expectedHMAC !== row.hmac_signature) { isValid = false; errors.push(`HMAC mismatch at ID ${row.id}`); }
      if (row.previous_hash !== previousHash) { isValid = false; errors.push(`Chain break at ID ${row.id}`); }
      previousHash = row.current_hash;
    }
    return { valid: isValid, total_records: result.rows.length, errors };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export default { logGovernanceEvent, verifyGovernanceChainIntegrity };
