import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging' });

const url = process.env.DATABASE_URL_LEARNING;
console.log("Probing Neon (Learning DB) directly...");
console.log("URL starts with:", url.substring(0, 25) + "...");

const pool = new pg.Pool({ 
  connectionString: url, 
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false } // Force SSL acceptance
});

pool.on('error', (err) => {
  console.error('[Pool Error]', err.message);
});

(async () => {
  let client;
  try {
    client = await pool.connect();
    console.log("✅ Connection Successful!");
    const res = await client.query('SELECT NOW() as time');
    console.log("DB Time:", res.rows[0].time);
  } catch (err) {
    console.error("❌ Connection Failed. Detailed Error:");
    console.error(err.stack);
  } finally {
    if (client) client.release();
    await pool.end();
    process.exit(0);
  }
})();
