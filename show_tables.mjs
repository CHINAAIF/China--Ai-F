import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true}});
try {
  const {rows} = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  rows.forEach(r => console.log(r.table_name));
} catch(e) {
  console.error('ERROR:', e.message);
}
await pool.end();
process.exit(0);
