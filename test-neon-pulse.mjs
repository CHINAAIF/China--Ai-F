import { getPool, generateDbToken } from './lib/db.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging' });

console.log("--- Starting Neon DB Pulse Test ---");

async function runTest() {
  try {
    console.log("Authenticating with Cryptographic Pool Lock...");
    const pool = getPool('main', generateDbToken('test-neon-pulse'));
    
    console.log("Connecting to Neon (This may take up to 15s for cold start)...");
    const client = await pool.connect();
    console.log("✅ Neon Connection Established!");
    
    console.log("Executing Pulse Query...");
    const res = await client.query('SELECT NOW() as current_time, current_database() as db_name');
    console.log("✅ DB Time:", res.rows[0].current_time);
    console.log("✅ DB Name:", res.rows[0].db_name);
    
    client.release();
    await pool.end();
    console.log("\n✅ PASS: Neon DB is reachable and operational.");
  } catch (err) {
    console.error("\n❌ FAIL: Neon DB unreachable.");
    console.error("Error:", err.message);
  }
  process.exit(0);
}
runTest();
