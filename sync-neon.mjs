import { getPool, generateDbToken } from './lib/db.js';

console.log("=== Starting TRUNKIA Neon DB Grand Sync ===");

const SQL_COMMANDS = [
  // 1. Grant absolute privileges to app_user on public schema
  "GRANT ALL ON SCHEMA public TO app_user;",
  "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;",
  "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;",
  
  // 2. Disable RLS on System Internal Tables (Agents write here, not external users)
  "ALTER TABLE routing_decisions DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE immune_audit_chain DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE immune_anomaly_log DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE immune_critic_evaluations DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE event_log DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE agent_execution_logs DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE intelligence_verified DISABLE ROW LEVEL SECURITY;",
  "ALTER TABLE judicial_routing_log DISABLE ROW LEVEL SECURITY;",
  
  // 3. Ensure critical columns exist (IF NOT EXISTS equivalent for columns)
  // We use a DO block to safely add columns if they are missing
  `DO $$   BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='routing_decisions' AND column_name='confidence') THEN
      ALTER TABLE routing_decisions ADD COLUMN confidence INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='routing_decisions' AND column_name='latency_ms') THEN
      ALTER TABLE routing_decisions ADD COLUMN latency_ms INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='routing_decisions' AND column_name='cost_usd') THEN
      ALTER TABLE routing_decisions ADD COLUMN cost_usd NUMERIC(10,6);
    END IF;
  END $$;`
];

async function run() {
  try {
    const pool = getPool('main', generateDbToken('sync-neon'));
    const client = await pool.connect();
    console.log("✅ Connected to Neon as app_user. Executing Sync...");

    for (const cmd of SQL_COMMANDS) {
      try {
        await client.query(cmd);
        console.log("✅ Executed:", cmd.substring(0, 60).replace(/\n/g, ' ') + "...");
      } catch (e) {
        console.error("❌ Failed:", e.message, "| CMD:", cmd.substring(0, 60));
      }
    }

    console.log("\n=== Sync Complete. Verifying Write Access... ===");
    // Final Test: Try to INSERT into routing_decisions
    try {
      await client.query("INSERT INTO routing_decisions (request_hash, task_type, model_selected, outcome, confidence) VALUES ($1, $2, $3, $4, $5)", ['sync_test', 'diagnostic', 'groq', 'routed', 100]);
      console.log("✅ VERIFIED: INSERT into routing_decisions is now ALLOWED!");
    } catch (e) {
      console.error("❌ VERIFICATION FAILED:", e.message);
    }

    client.release();
    await pool.end();
  } catch (e) {
    console.error("Fatal Sync Error:", e.message);
  }
  process.exit(0);
}
run();
