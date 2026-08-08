import fs from 'fs';
const f = 'lib/immune-system.mjs';
let c = fs.readFileSync(f, 'utf8');

// 1. Fix Default Secret
c = c.replace(
  "const IMMUNE_SECRET = process.env.IMMUNE_SECRET || 'trunkia_immune_2026';",
  "const IMMUNE_SECRET = process.env.IMMUNE_SECRET;\nif (!IMMUNE_SECRET) throw new Error('CRITICAL: IMMUNE_SECRET is not set. Immune System cannot sign audit chains.');"
);

// 2. Fix Race Condition in recordAuditEvent
const oldFunc = `export async function recordAuditEvent(eventType, entityId, action, details) {
  try {
    const client = await pool.connect();
    try {
      // Get previous hash
      const prevRes = await client.query("SELECT current_hash FROM immune_audit_chain ORDER BY created_at DESC LIMIT 1");
      const prevHash = prevRes.rows.length > 0 ? prevRes.rows[0].current_hash : 'GENESIS';

      // Calculate current hash
      const payload = JSON.stringify({ eventType, entityId, action, details, prevHash, ts: new Date().toISOString() });
      const currentHash = crypto.createHash('sha256').update(payload).digest('hex');

      // HMAC Signature (proves it was written by immune system)
      const hmacSig = crypto.createHmac('sha256', IMMUNE_SECRET).update(currentHash).digest('hex');

      await client.query(
        "INSERT INTO immune_audit_chain (id, event_type, entity_id, action, details, prev_hash, current_hash, hmac_signature, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())",
        [eventType, entityId, action, JSON.stringify(details), prevHash, currentHash, hmacSig]
      );

      return currentHash;
    } finally { client.release(); }
  } catch (e) { console.error('[AUDIT_ERR]', e.message); }
}`;

const newFunc = `export async function recordAuditEvent(eventType, entityId, action, details) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Atomic Lock: Prevents concurrent reads of the same prev_hash
    const prevRes = await client.query("SELECT current_hash FROM immune_audit_chain ORDER BY created_at DESC LIMIT 1 FOR UPDATE");
    const prevHash = prevRes.rows.length > 0 ? prevRes.rows[0].current_hash : 'GENESIS';

    const payload = JSON.stringify({ eventType, entityId, action, details, prevHash, ts: new Date().toISOString() });
    const currentHash = crypto.createHash('sha256').update(payload).digest('hex');
    const hmacSig = crypto.createHmac('sha256', IMMUNE_SECRET).update(currentHash).digest('hex');

    await client.query(
      "INSERT INTO immune_audit_chain (id, event_type, entity_id, action, details, prev_hash, current_hash, hmac_signature, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())",
      [eventType, entityId, action, JSON.stringify(details), prevHash, currentHash, hmacSig]
    );
    
    await client.query('COMMIT');
    return currentHash;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[AUDIT_ERR]', e.message);
  } finally {
    client.release();
  }
}`;

if (c.includes(oldFunc)) {
  c = c.replace(oldFunc, newFunc);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched lib/immune-system.mjs (Fixed Race Condition & Default Secret)');
} else {
  console.error('❌ FAIL: Could not find the vulnerable recordAuditEvent function.');
}
