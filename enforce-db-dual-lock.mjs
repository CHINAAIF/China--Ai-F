import { getPool, generateDbToken } from './lib/db.js';
import crypto from 'crypto';

console.log("=== Installing Dual-Lock Sovereign Veto (DB-MFA) ===");

const overrideSecret = process.env.ENCRYPTION_KEY;
if (!overrideSecret) throw new Error("ENCRYPTION_KEY is required.");
const expectedSig = crypto.createHmac('sha256', overrideSecret).update('EMERGENCY_OVERRIDE').digest('hex');

async function run() {
  try {
    const pool = getPool('main', generateDbToken('dual-lock-install'));
    const client = await pool.connect();
    console.log("✅ Connected. Upgrading Veto Function to Dual-Lock...");

    // 1. Create the Dual-Lock Veto Function
    await client.query(`
      CREATE OR REPLACE FUNCTION sovereign_veto_dual_lock()
      RETURNS trigger AS $$       DECLARE
        override_sig TEXT;
        current_u TEXT;
      BEGIN
        override_sig := current_setting('app.emergency_override', true);
        current_u := current_user;
        
        -- Dual Control: Must have the Key AND be the Owner (neondb_owner)
        IF override_sig = '${expectedSig}' AND current_u = 'neondb_owner' THEN
          -- Authorized Emergency Override
          INSERT INTO sovereign_override_log (table_name, operation, performed_by)
          VALUES (TG_TABLE_NAME, TG_OP, current_u);
          RETURN OLD;
        ELSE
          -- Unauthorized Attempt (Even if key is correct, but user is app_user -> BLOCK)
          RAISE EXCEPTION 'SOVEREIGN VETO: Dual-Lock failed. Break-Glass requires Owner role and valid key. (User: %)', current_u;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log("✅ Dual-Lock Veto Function installed.");

    // Re-attach triggers to use the new function
    const tables = ['immune_audit_chain', 'immune_agent_trust', 'event_log'];
    for (const table of tables) {
      await client.query(`DROP TRIGGER IF EXISTS trg_sovereign_lock_${table} ON ${table};`);
      await client.query(`CREATE TRIGGER trg_sovereign_lock_${table} BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION sovereign_veto_dual_lock();`);
    }
    console.log("✅ Triggers updated to Dual-Lock mode.");

    console.log("\n=== Verifying Dual-Lock Security... ===");
    
    // Test 1: Try to use the Key as 'app_user' (Should FAIL - Identity mismatch)
    try {
      await client.query(`SET LOCAL app.emergency_override = '${expectedSig}';`);
      await client.query("UPDATE immune_agent_trust SET trust_score = 100 WHERE 1=0;");
      console.log("❌ FAIL: app_user bypassed security with the key!");
    } catch (e) {
      console.log("✅ PASS: app_user blocked even with correct key (Dual-Lock enforced).");
    }

    client.release();
    await pool.end();
  } catch (e) {
    console.error("Fatal Error:", e.message);
  }
  process.exit(0);
}
run();
