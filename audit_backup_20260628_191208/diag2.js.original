import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { readFileSync } from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function diag() {
  try {
    // 1. safe-json escalation check
    const sj = readFileSync('/data/data/com.termux/files/home/downloads/China--Ai-F/agents/utils/safe-json.js','utf8');
    console.log(`safe-json has escalation: ${sj.includes('escalat')?'YES':'NO'}`);
    console.log(`safe-json has confidence tiers: ${sj.includes('confidence')?'YES':'NO'}`);
    const lines = sj.split('\n');
    lines.forEach((l,i) => { if(l.includes('escalat')||l.includes('confidence>=')) console.log(`  L${i+1}: ${l.trim()}`); });

    // 2. webhook_queue
    const wqC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='webhook_queue' ORDER BY ordinal_position");
    const wqN = await pool.query("SELECT count(*) as c FROM webhook_queue");
    console.log(`\nwebhook_queue: ${wqN.rows[0].c} rows`);
    wqC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 3. subscription_plans
    const spC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='subscription_plans' ORDER BY ordinal_position");
    const spN = await pool.query("SELECT count(*) as c FROM subscription_plans");
    console.log(`\nsubscription_plans: ${spN.rows[0].c} rows`);
    spC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 4. governance_contracts columns
    const gcC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='governance_contracts' ORDER BY ordinal_position");
    console.log('\ngovernance_contracts:');
    gcC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 5. routing_decisions columns
    const rdC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='routing_decisions' ORDER BY ordinal_position");
    console.log('\nrouting_decisions:');
    rdC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 6. advisor-layer hash logic - find the UPDATE line
    const al = readFileSync('/data/data/com.termux/files/home/downloads/China--Ai-F/agents/governance/advisor-layer.js','utf8');
    const alLines = al.split('\n');
    alLines.forEach((l,i) => { if(l.includes('payload_hash')||l.includes('hash_update')||l.includes('pending')) console.log(`\nAL L${i+1}: ${l.trim()}`); });

    // 7. byok_keys columns
    const bkC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='byok_keys' ORDER BY ordinal_position");
    console.log('\nbyok_keys:');
    bkC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

    // 8. nonce_registry columns
    const nrC = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='nonce_registry' ORDER BY ordinal_position");
    console.log('\nnonce_registry:');
    nrC.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type}`));

  } catch(e) { console.error('ERR:', e.message); }
  await pool.end();
}
diag();
