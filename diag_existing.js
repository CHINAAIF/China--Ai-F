import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function diag() {
  try {
    // 1. event_log schema
    const cols = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='event_log' ORDER BY ordinal_position");
    console.log('=== event_log columns ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable:${r.is_nullable}`));

    // 2. check hash_update_failed entries
    const badHash = await pool.query("SELECT id, event_type, payload_hash, created_at FROM event_log WHERE payload_hash='pending...' OR payload_hash IS NULL ORDER BY created_at DESC LIMIT 5");
    console.log('\n=== entries with bad hash ===');
    badHash.rows.forEach(r => console.log(`  ${r.id} | ${r.event_type} | hash:${r.payload_hash} | ${r.created_at}`));

    // 3. list existing agent files
    const { execSync } = await import('child_process');
    const dirs = ['agents/governance','agents/sovereign','agents/intelligence','agents/learning','agents/utils','routes'];
    for (const d of dirs) {
      try {
        const files = execSync(`ls ~/downloads/China--Ai-F/${d}/ 2>/dev/null`,{encoding:'utf8'}).trim().split('\n');
        console.log(`\n=== ${d}/ ===`);
        files.forEach(f => console.log(`  ${f}`));
      } catch(e) { console.log(`\n=== ${d}/ === (not found)`); }
    }

    // 4. check which tables exist
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
    console.log('\n=== ALL TABLES ===');
    tables.rows.forEach(r => console.log(`  ${r.table_name}`));

  } catch(e) { console.error('DIAG ERROR:', e.message); }
  await pool.end();
}
diag();
