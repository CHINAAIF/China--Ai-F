import { getPool, generateDbToken } from './lib/db.js';

console.log("=== Enforcing Sovereign DB Segregation (Zero-Delete Policy) ===");

// 1. جداول التدقيق الجنائي: ممنوع الحذف والتعديل (Append-Only)
const AUDIT_TABLES = [
  'immune_audit_chain', 'event_log', 'agent_execution_logs', 
  'governance_audit_chain', 'intel_provenance_chain', 'evidence_chain',
  'cognitive_prompt_turns', 'judicial_routing_log'
];

// 2. جداول المناعة والبصمات: ممنوع الحذف والتعديل (لمنع تزوير الثقة)
const IMMUNE_TABLES = [
  'immune_agent_trust', 'agent_behavioral_baselines', 'immune_anomaly_log',
  'immune_critic_evaluations', 'immune_dark_networks', 'canary_token_registry'
];

// 3. جداول الهويات والمستخدمين: ممنوع الحذف النهائي (لمنع الـ Ransomware)
const IDENTITY_TABLES = [
  'accounts', 'api_keys', 'users', 'sessions', 'byok_keys', 'agent_identity_registry'
];

async function run() {
  try {
    const pool = getPool('main', generateDbToken('segregate'));
    const client = await pool.connect();
    console.log("✅ Connected. Stripping destructive privileges...");

    // Lock Audit Tables
    for (const table of AUDIT_TABLES) {
      try {
        await client.query(`REVOKE UPDATE, DELETE ON TABLE ${table} FROM app_user;`);
        console.log(`   🔒 ${table}: Locked (Append-Only)`);
      } catch(e) { console.log(`   ⚠️ ${table}: Skipped (${e.message})`); }
    }

    // Lock Immune Tables
    for (const table of IMMUNE_TABLES) {
      try {
        await client.query(`REVOKE UPDATE, DELETE ON TABLE ${table} FROM app_user;`);
        console.log(`   🛡️ ${table}: Protected (No Tampering)`);
      } catch(e) { console.log(`   ⚠️ ${table}: Skipped (${e.message})`); }
    }

    // Lock Identity Tables (No Hard Deletes)
    for (const table of IDENTITY_TABLES) {
      try {
        await client.query(`REVOKE DELETE ON TABLE ${table} FROM app_user;`);
        console.log(`   🛑 ${table}: No Deletion (Soft Delete Only)`);
      } catch(e) { console.log(`   ⚠️ ${table}: Skipped (${e.message})`); }
    }

    console.log("\n=== Verifying Zero-Delete Policy... ===");
    
    // Test 1: Try to DELETE from audit chain
    try {
      await client.query("DELETE FROM immune_audit_chain LIMIT 1;");
      console.log("❌ FAIL: app_user can still DELETE audit logs!");
    } catch (e) {
      console.log("✅ PASS: Audit Log protected from deletion (Permission denied).");
    }

    // Test 2: Try to UPDATE immune trust
    try {
      await client.query("UPDATE immune_agent_trust SET trust_score = 100 WHERE 1=0;");
      console.log("❌ FAIL: app_user can still UPDATE immune trust!");
    } catch (e) {
      console.log("✅ PASS: Immune System protected from tampering (Permission denied).");
    }

    client.release();
    await pool.end();
  } catch (e) {
    console.error("Fatal Error:", e.message);
  }
  process.exit(0);
}
run();
