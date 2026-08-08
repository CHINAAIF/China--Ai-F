import crypto from 'crypto';
import { getPool, generateDbToken } from './lib/db.js';

console.log("--- Testing Dual-Lock from app_user ---");

const expectedSig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update('EMERGENCY_OVERRIDE').digest('hex');

try {
  const pool = getPool('main', generateDbToken('dual-test'));
  const client = await pool.connect();
  
  // Try to use the key as app_user
  await client.query("SET LOCAL app.emergency_override = $1", [expectedSig]);
  await client.query("UPDATE immune_agent_trust SET trust_score = 100 WHERE 1=0;");
  console.log("❌ FAIL: app_user bypassed security with the key!");
} catch (e) {
  console.log("✅ PASS: app_user blocked even with correct key (Dual-Lock enforced).");
  console.log("   Error:", e.message.substring(0, 80));
}
process.exit(0);
