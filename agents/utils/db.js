import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => { console.error('⚠️ pg pool unexpected error:', err.message); });

export default pool;
