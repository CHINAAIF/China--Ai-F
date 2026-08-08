import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging' });

console.log("--- Testing Neon via Serverless Driver (Port 443 Bypass) ---");

// This driver uses HTTP/WebSockets, bypassing TCP 5432 carrier blocks
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const client = await pool.connect();
  console.log("✅ Neon Serverless Connection Successful!");
  const res = await client.query('SELECT NOW() as time, current_database() as db');
  console.log("DB Time:", res.rows[0].time);
  console.log("DB Name:", res.rows[0].db);
  client.release();
  await pool.end();
} catch (e) {
  console.error("❌ FAILED:", e.message);
}
process.exit(0);
