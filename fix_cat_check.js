import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function run() {
  try {
    await pool.query("ALTER TABLE data_sensitivity_rules DROP CONSTRAINT data_sensitivity_rules_category_check");
    console.log('dropped');
  } catch(e) { console.log('drop: ' + e.message); }
  try {
    await pool.query("ALTER TABLE data_sensitivity_rules ADD CONSTRAINT data_sensitivity_rules_category_check CHECK (category IN ('pii','financial','health','government','proprietary','public','attack','network','device'))");
    console.log('OK: added attack+network+device');
  } catch(e) { console.log('add: ' + e.message); }
  await pool.end();
}
run();
