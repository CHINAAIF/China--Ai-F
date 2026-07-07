import { getPool } from '../../lib/db.js';



if (!process.env.DATABASE_URL_SECURITY) {
  throw new Error(
    'CRITICAL: DATABASE_URL_SECURITY is required for security agents. Refusing to use shared DATABASE_URL.'
  );
}

export const pool = getPool('security');

pool.on('error', (err) => {
  console.error('CRITICAL: Security database pool error:', err.message);
});
