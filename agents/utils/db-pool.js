import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

// ── Pool مركزي واحد لكل النظام ──────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,                    // حد أقصى 20 اتصال
  min: 2,                     // اتصالان دائمان
  idleTimeoutMillis: 30000,   // إغلاق الخامل بعد 30s
  connectionTimeoutMillis: 5000, // timeout الاتصال 5s
  allowExitOnIdle: false
});

// ── مراقبة Pool ─────────────────────────────────────────────────
pool.on('connect', () => {
  if (pool.totalCount > 15) {
    console.warn(`⚠️  DB Pool high: ${pool.totalCount} connections`);
  }
});

pool.on('error', (err) => {
  console.error('🚨 DB Pool error:', err.message);
});

// ── تحقق فوري ───────────────────────────────────────────────────
try {
  await pool.query('SELECT 1');
  console.log(`✅ DB Pool ready — max:20 idle:${pool.idleCount} total:${pool.totalCount}`);
} catch(e) {
  console.error('❌ DB Pool failed:', e.message);
}

export { pool };
export default pool;
