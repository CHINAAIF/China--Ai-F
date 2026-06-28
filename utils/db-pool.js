import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// ── التحقق الصارم من البيئة ────────────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not defined. System cannot start.');
}

// ── تنظيف URL من معاملات غير مدعومة ──────────────────────────
function sanitizeDbUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('postgres')) {
    throw new Error('CRITICAL: DATABASE_URL format is invalid.');
  }
  const [base, qs] = url.split('?');
  if (!qs) return url;
  const filtered = qs
    .split('&')
    .filter(p => !p.startsWith('channel_binding='))
    .join('&');
  return filtered ? `${base}?${filtered}` : base;
}

// ── SSL صارم في الإنتاج ───────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction
  ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT || undefined }
  : { rejectUnauthorized: false };

// ── Pool مفرد مع حماية Race Condition ────────────────────────
let pool = null;
let poolInitializing = false;

export function getPool() {
  if (pool) return pool;
  if (poolInitializing) throw new Error('Pool initialization in progress');
  poolInitializing = true;
  pool = new pg.Pool({
    connectionString: sanitizeDbUrl(process.env.DATABASE_URL),
    ssl: sslConfig,
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 30000,
    allowExitOnIdle: false,
  });

  pool.on('error', (err) => {
    console.error('[db-pool] Unexpected error:', err.message);
  });

  pool.on('connect', () => {
    if (pool.totalCount > 15) {
      console.warn(`[db-pool] High connections: ${pool.totalCount}/20`);
    }
  });

  poolInitializing = false;
  return pool;
}

// ── Query مع validation ───────────────────────────────────────
export function query(text, params) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('SECURITY: Empty query rejected');
  }
  return getPool().query(text, params);
}

export function getClient() {
  return getPool().connect();
}

export async function shutdownPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
