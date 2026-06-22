import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function fix() {
  try {
    const bad = await pool.query(
      "SELECT id, payload::text as raw_text FROM event_log WHERE payload_hash IN ('pending','pending...','computing') ORDER BY created_at"
    );
    console.log('found ' + bad.rows.length + ' bad entries');
    let fixed = 0;
    for (const row of bad.rows) {
      try {
        const hash = crypto.createHash('sha256').update(row.raw_text, 'utf8').digest('hex');
        const up = await pool.query('UPDATE event_log SET payload_hash=$1 WHERE id=$2', [hash, row.id]);
        if (up.rowCount > 0) fixed++;
      } catch(e) { /* skip */ }
    }
    console.log('fixed: ' + fixed);
    const rem = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
    console.log('remaining: ' + rem.rows[0].c);
    const last5 = await pool.query("SELECT event_type, substring(payload_hash,1,24) as h FROM event_log ORDER BY created_at DESC LIMIT 5");
    console.log('last 5 hashes:');
    last5.rows.forEach(function(r) { console.log('  ' + r.event_type + ' | ' + r.h + '...'); });
  } catch(e) { console.error('ERR: ' + e.message); }
  await pool.end();
}
fix();
