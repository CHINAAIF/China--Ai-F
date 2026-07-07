// TRUNKIA - Intelligence Layer Database Connection (ISOLATED)
import { getPool } from '../../lib/db.js';

const pool = getPool('intelligence');

pool.on('error', (err) => {
  console.error('[INTELLIGENCE DB] Pool error:', err.message);
});

export { pool };
export default pool;
