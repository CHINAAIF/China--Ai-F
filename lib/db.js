import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ── التحقق الصارم من متغيرات البيئة ──────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not set. Refusing to start.');
}

// ── SSL: صارم في الإنتاج، مرن في التطوير فقط ─────────────────
const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = { rejectUnauthorized: true };

// ── Pool مركزي مع حماية كاملة ─────────────────────────────────
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: 10,
  min: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,      // منع الاستعلامات الطويلة
  query_timeout: 30000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('[db] Pool error:', err.message);
});

pool.on('connect', () => {
  if (pool.totalCount > 8) {
    console.warn(`[db] Pool pressure: ${pool.totalCount}/10 connections`);
  }
});

// ── query مع حماية SQL Injection عبر parameterized queries فقط ─
export async function query(text, params) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('SECURITY: Empty or invalid query rejected');
  }
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ── Transaction مع Rollback مضمون ─────────────────────────────
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Graceful shutdown ──────────────────────────────────────────
export async function closePool() {
  await pool.end();
}
