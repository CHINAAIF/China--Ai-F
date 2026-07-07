// TRUNKIA - Governance Layer Database Connection (ISOLATED)
import { getPool } from '../../lib/db.js';

if (!process.env.DATABASE_URL_GOVERNANCE) {
  throw new Error('CRITICAL: DATABASE_URL_GOVERNANCE is not set. Refusing to start.');
}

const pool = getPool('governance');

pool.on('error', (err) => {
  console.error('[GOVERNANCE DB] Pool error:', err.message);
});

export { pool };
export default pool;
