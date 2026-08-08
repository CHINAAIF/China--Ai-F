import fs from 'fs';

// 1. Patch Immune System Race Condition
const immunePath = 'lib/immune-system.mjs';
let immune = fs.readFileSync(immunePath, 'utf8');

const immuneRegex = /export async function recordAuditEvent\(eventType, entityId, action, details\) \{[\s\S]*?\n\}/;
const newImmuneFunc = `export async function recordAuditEvent(eventType, entityId, action, details) {
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

if (immuneRegex.test(immune)) {
  immune = immune.replace(immuneRegex, newImmuneFunc);
  fs.writeFileSync(immunePath, immune, 'utf8');
  console.log('✅ Patched lib/immune-system.mjs (Race Condition Fixed via Regex)');
} else {
  console.log('❌ FAIL: Could not find recordAuditEvent in immune-system.mjs');
}

// 2. Patch CORS in index.js to allow localhost in development
const indexPath = 'index.js';
let index = fs.readFileSync(indexPath, 'utf8');

if (index.includes("return callback(new Error('CORS blocked: Strict Origin Policy'));")) {
  // Inject a dev-friendly bypass before the strict rejection
  index = index.replace(
    "return callback(new Error('CORS blocked: Strict Origin Policy'));",
    "if (process.env.NODE_ENV !== 'production' && (!origin || origin.includes('localhost'))) return callback(null, true);\n    return callback(new Error('CORS blocked: Strict Origin Policy'));"
  );
  fs.writeFileSync(indexPath, index, 'utf8');
  console.log('✅ Patched index.js (CORS bypass for localhost in non-production)');
} else {
  console.log('⚠️ CORS strict policy string not found (might be already patched).');
}
