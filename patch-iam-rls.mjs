import fs from 'fs';
const f = 'lib/iam-gateway.mjs';
let c = fs.readFileSync(f, 'utf8');

// Add the set_config call inside the transaction
const oldTxStart = `    await client.query('BEGIN');
    // Atomic User Creation`;
    
const newTxStart = `    await client.query('BEGIN');
    // RLS Compliance: Set tenant context for system user
    await client.query("SELECT set_config('app.current_id', $1, true)", [SOVEREIGN_SYSTEM_USER_ID]);
    // Atomic User Creation`;

if (c.includes(oldTxStart)) {
  c = c.replace(oldTxStart, newTxStart);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched iam-gateway.mjs (RLS Compliance for users table)');
} else {
  console.log('❌ Could not find transaction start.');
}
