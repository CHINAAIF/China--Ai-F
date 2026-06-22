import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function diag() {
  var r = await pool.query("SELECT rulename, definition FROM pg_rules WHERE tablename='event_log'");
  console.log('Rules on event_log: ' + r.rows.length);
  r.rows.forEach(function(row) { console.log('\n' + row.rulename + ':\n' + row.definition); });
  await pool.end();
}
diag();
