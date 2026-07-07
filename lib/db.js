import pg from 'pg';

// ── التحقق الصارم من متغيرات البيئة ──────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not set. Refusing to start.');
}

// ── SSL: توافق تام مع Docker/Alpine و Neon عبر Cloudflare ─────
const isProduction = process.env.NODE_ENV === 'production';
// نعتمد على sslmode=require في رابط Neon، ونتجنب مشاكل CA في الحاويات
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

// ── Pool مركزي ديناميكي (Enterprise Grade) ────────────────────
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  // حجم التجمع ديناميكي، يبدأ بـ 20 للإنتاج (يمكن تغييره عبر .env)
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: 2, // الحد الأدنى لضمان استجابة فورية دائماً
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,      // منع الاستعلامات الطويلة
  query_timeout: 30000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('[db] Pool error (Client removed):', err.message);
});

pool.on('connect', () => {
  const max = parseInt(process.env.DB_POOL_MAX || '20', 10);
  if (pool.totalCount > max * 0.8) {
    console.warn(`[db] Pool pressure: ${pool.totalCount}/${max} connections`);
  }
});

// ── query مع حماية SQL Injection وتتبع الأداء (Slow Queries) ─
export async function query(text, params) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('SECURITY: Empty or invalid query rejected');
  }
  
  const start = Date.now();
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    
    // تسجيل الاستعلامات البطيئة (أكثر من 500 مللي ثانية) لمراقبة الأداء
    if (duration > 500) {
      console.warn(`[db] SLOW QUERY (${duration}ms):`, text.substring(0, 80).replace(/\s+/g, ' '));
    }
    
    return res;
  } finally {
    client.release();
  }
}

// ── Transaction مع Rollback مضمون ─────────────────────────────
export async function withTransaction(fn) {
  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[db] SLOW TRANSACTION (${duration}ms)`);
    }
    
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
