import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { readFileSync } from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function diag() {
  try {
    // 1. event_log last 5 hash values
    const ev = await pool.query("SELECT id, event_type, payload_hash, substring(payload::text,1,60) as payload_preview FROM event_log ORDER BY created_at DESC LIMIT 5");
    console.log('=== event_log last 5 ===');
    ev.rows.forEach(r => console.log(`  ${r.event_type} | hash:${r.payload_hash} | ${r.payload_preview}`));

    // 2. tables NOT in DB that البند 8 needs
    const need = ['compliance_checks','privacy_scores','incident_reports','data_sensitivity_rules'];
    for (const t of need) {
      const ex = await pool.query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name=$1)",[t]);
      console.log(`  table ${t}: ${ex.rows[0].exists ? 'EXISTS' : 'MISSING'}`);
    }

    // 3. check safe-json for escalation
    const sj = readFileSync('/root/downloads/China--Ai-F/agents/utils/safe-json.js','utf8');
    console.log(`\n=== safe-json.js has escalation: ${sj.includes('escalat') ? 'YES' : 'NO'} ===`);
    console.log(`  has confidence tiers: ${sj.includes('confidence>=80') || sj.includes('confidence >= 80') ? 'YES' : 'NO'}`);

    // 4. webhook_queue structure + count
    const wqCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='webhook_queue' ORDER BY ordinal_position");
    const wqCount = await pool.query("SELECT count(*) as c FROM webhook_queue");
    console.log(`\n=== webhook_queue: ${wqCount.rows[0].c} rows ===`);
    wqCols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 5. subscription_plans + billing_events count
    const sp = await pool.query("SELECT count(*) as c FROM subscription_plans");
    const be = await pool.query("SELECT count(*) as c FROM billing_events");
    console.log(`\n  subscription_plans: ${sp.rows[0].c} rows`);
    console.log(`  billing_events: ${be.rows[0].c} rows`);

    // 6. governance_contracts structure
    const gcCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='governance_contracts' ORDER BY ordinal_position");
    console.log('\n=== governance_contracts columns ===');
    gcCols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 7. routing_decisions structure
    const rdCols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='routing_decisions' ORDER BY ordinal_position");
    console.log('\n=== routing_decisions columns ===');
    rdCols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 8. customer_schemas count
    const cs = await pool.query("SELECT count(*) as c FROM customer_schemas");
    console.log(`\n  customer_schemas: ${cs.rows[0].c} rows`);

  } catch(e) { console.error('DIAG ERROR:', e.message); }
  await pool.end();
}
diag();
