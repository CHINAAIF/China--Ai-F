import pg from 'pg';
import dotenv from 'dotenv';
import dns from 'dns';

// Force IPv4 to bypass Termux/Carrier IPv6 routing issues
dns.setDefaultResultOrder('ipv4first');

dotenv.config({ path: '.env.staging' });

const url = process.env.DATABASE_URL_LEARNING;
console.log("Probing Neon (Learning DB) with FORCED IPv4...");

const pool = new pg.Pool({ 
  connectionString: url, 
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  let client;
  try {
    client = await pool.connect();
    console.log("✅ IPv4 Connection Successful!");
    const res = await client.query('SELECT NOW() as time');
    console.log("DB Time:", res.rows[0].time);
  } catch (err) {
    console.error("❌ IPv4 Connection Failed. Detailed Error:");
    console.error(err.message);
  } finally {
    if (client) client.release();
    await pool.end();
    process.exit(0);
  }
})();
