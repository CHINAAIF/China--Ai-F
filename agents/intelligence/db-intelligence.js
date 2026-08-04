// TRUNKIA - Intelligence Layer Database Connection (ISOLATED)
import { getPool, generateDbToken } from '../../lib/db.js';

const pool = getPool('intelligence', generateDbToken('agents/intelligence/db-intelligence.js'));

pool.on('error', (err) => {
  console.error('[INTELLIGENCE DB] Pool error:', err.message);
});

export { pool };
export default pool;
