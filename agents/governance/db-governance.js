// TRUNKIA - Governance Layer Database Connection (ISOLATED)
import pg from 'pg';

if (!process.env.DATABASE_URL_GOVERNANCE) {
  throw new Error('CRITICAL: DATABASE_URL_GOVERNANCE is not set. Refusing to start.');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_GOVERNANCE,
  ssl: { rejectUnauthorized: true }
});

pool.on('error', (err) => {
  console.error('[GOVERNANCE DB] Pool error:', err.message);
});

export { pool };
export default pool;
