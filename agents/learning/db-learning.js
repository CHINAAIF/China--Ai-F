import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DATABASE_URL_LEARNING) {
  throw new Error('CRITICAL: DATABASE_URL_LEARNING غير معرّف — وكلاء التعلم لا يمكنها العمل بدون دور مخصص');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_LEARNING,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[agent_learning_role pool] error:', err.message);
});

export default pool;
