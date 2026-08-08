import crypto from 'crypto';
import { getPool, generateDbToken } from './lib/db.js';

console.log("--- Testing Dual-Lock (Real Trigger Test) ---");

const expectedSig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update('EMERGENCY_OVERRIDE').digest('hex');

try {
  const pool = getPool('main', generateDbToken('dual-test-v2'));
  const client = await pool.connect();
  
  // 1. Set the Emergency Override Key using set_config
  await client.query("SELECT set_config('app.emergency_override', $1, true)", [expectedSig]);
  
  // 2. Attempt the UPDATE (This should hit the Trigger if it exists)
  await client.query("UPDATE immune_agent_trust SET trust_score = 100 WHERE 1=0;");
  
  // If we reach here, the trigger didn't block it
  console.log("❌ FAIL: app_user bypassed security! (Trigger not armed or missing)");
} catch (e) {
  if (e.message.includes('SOVEREIGN VETO')) {
    console.log("✅ PASS: Dual-Lock Trigger blocked the update successfully!");
    console.log("   Error:", e.message);
  } else {
    console.log("❌ FAIL: An unexpected error occurred:", e.message);
  }
}
process.exit(0);
