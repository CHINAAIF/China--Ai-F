// TRUNKIA - Intelligence Layer Database Connection (ISOLATED)
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_INTELLIGENCE,
  ssl: { rejectUnauthorized: true }
});

pool.on('error', (err) => {
  console.error('[INTELLIGENCE DB] Pool error:', err.message);
});

export { pool };
export default pool;
