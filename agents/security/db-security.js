import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL_SECURITY) {
  throw new Error(
    'CRITICAL: DATABASE_URL_SECURITY is required for security agents. Refusing to use shared DATABASE_URL.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL_SECURITY,
  ssl: {
    rejectUnauthorized: true
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('CRITICAL: Security database pool error:', err.message);
});
