#!/bin/bash
set -e
cd ~/downloads/China--Ai-F

echo "=== 1/3: إنشاء الجداول وحمايتها ==="
node --input-type=module << 'ENDOFFILE'
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

await pool.query(`
  CREATE TABLE IF NOT EXISTS governance_audit_chain (
    id BIGSERIAL PRIMARY KEY,
    previous_hash VARCHAR(64),
    current_hash VARCHAR(64) NOT NULL,
    hmac_signature VARCHAR(64) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    table_name VARCHAR(200),
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await pool.query(`CREATE OR REPLACE RULE governance_audit_chain_no_update AS ON UPDATE TO governance_audit_chain DO INSTEAD NOTHING;`);
await pool.query(`CREATE OR REPLACE RULE governance_audit_chain_no_delete AS ON DELETE TO governance_audit_chain DO INSTEAD NOTHING;`);
console.log('✅ governance_audit_chain جاهز ومحمي');

await pool.query(`
  CREATE TABLE IF NOT EXISTS governance_protection_registry (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(200) UNIQUE NOT NULL,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'unknown',
    status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await pool.query(`CREATE OR REPLACE RULE governance_protection_registry_no_delete AS ON DELETE TO governance_protection_registry DO INSTEAD NOTHING;`);
console.log('✅ governance_protection_registry جاهز ومحمي من الحذف');

await pool.end();
ENDOFFILE

echo ""
echo "=== 2/3: استبدال governance-audit-chain.js بنسخة مُصلَّحة ==="
cat > lib/governance-audit-chain.js << 'JSEOF'
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
JSEOF
echo "✅ governance-audit-chain.js تم استبداله"

echo ""
echo "=== 3/3: توليد مفتاح HMAC عشوائي آمن ==="
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "GOVERNANCE_HMAC_SECRET=$SECRET" >> .env
echo "✅ تمت إضافة GOVERNANCE_HMAC_SECRET إلى .env تلقائياً"
echo ""
echo "⚠️  مهم جداً: هذا السطر أُضيف فقط لملف .env المحلي."
echo "⚠️  يجب أن تنسخ نفس القيمة يدوياً إلى Railway → Environment Variables"
echo "⚠️  شغّل هذا الأمر لعرض القيمة لتنسخها إلى Railway فقط:"
echo "    tail -1 .env"

echo ""
echo "=== تم الانتهاء من جميع الخطوات ==="
