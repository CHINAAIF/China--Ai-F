import fs from 'fs';
const f = 'lib/iam-gateway.mjs';
let c = fs.readFileSync(f, 'utf8');

const oldGen = `export async function generateNewApiKey(userId, dailyLimit = 1.00) {
  const rawKey = 'sk-trunkia-' + crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [SOVEREIGN_SYSTEM_USER_ID, 'sovereign-system@trunkia.internal']
    );
    await client.query(
      "INSERT INTO api_keys (id, user_id, name, key, status, scopes, metadata, created_at) VALUES (gen_random_uuid(), $1, 'sovereign_gateway', $2, 'active', '{inference}', $3, NOW())",
      [SOVEREIGN_SYSTEM_USER_ID, rawKey, JSON.stringify({ daily_limit_usd: dailyLimit })]
    );
    return rawKey;
  } finally {
    client.release();
  }
}`;

const newGen = `export async function generateNewApiKey(userId, dailyLimit = 1.00) {
  const rawKey = 'sk-trunkia-' + crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Atomic User Creation
    await client.query(
      'INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [SOVEREIGN_SYSTEM_USER_ID, 'sovereign-system@trunkia.internal']
    );
    // Atomic Key Creation
    await client.query(
      "INSERT INTO api_keys (id, user_id, name, key, status, scopes, metadata, created_at) VALUES (gen_random_uuid(), $1, 'sovereign_gateway', $2, 'active', '{inference}', $3, NOW())",
      [SOVEREIGN_SYSTEM_USER_ID, rawKey, JSON.stringify({ daily_limit_usd: dailyLimit })]
    );
    await client.query('COMMIT');
    return rawKey;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}`;

if (c.includes(oldGen)) {
  c = c.replace(oldGen, newGen);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched iam-gateway.mjs (Atomic Key Generation)');
} else {
  console.log('❌ Could not find generateNewApiKey function.');
}
