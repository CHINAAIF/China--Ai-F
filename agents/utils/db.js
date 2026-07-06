import dotenv from 'dotenv'; import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => { console.error('⚠️ pg pool unexpected error:', err.message); });

export default pool;
