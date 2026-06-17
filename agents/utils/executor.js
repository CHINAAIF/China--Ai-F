import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// ── القواعد الصارمة الإلزامية لكل عملية ────────────────────────
// 1. كل خطوة في try/catch مستقل — فشل خطوة لا يوقف الباقي
// 2. عند أي خطأ: شخّص → أصلح → أعد تلقائياً في نفس التشغيل
// 3. لا تخمّن بنية DB — افحص information_schema أولاً
// 4. لا تُعلن نجاح إلا بـSELECT تحقق فعلي بعد INSERT
// 5. كل إضافة في ملفات وجداول جديدة فقط — لا تعديل على الموجود
// 6. لا تضارب مع 108 وكيل موجودين
// ────────────────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── ضمان وجود مجلد قبل أي عملية ────────────────────────────────
export async function ensureDir(path) {
  try {
    if (!existsSync(path)) await mkdir(path, { recursive: true });
  } catch(_) {}
}

// ── فحص جدول قبل أي INSERT ──────────────────────────────────────
export async function tableExists(tableName) {
  try {
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
    `, [tableName]);
    return rows.length > 0;
  } catch(_) { return false; }
}

// ── فحص عمود قبل استخدامه ───────────────────────────────────────
export async function columnExists(table, column) {
  try {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    `, [table, column]);
    return rows.length > 0;
  } catch(_) { return false; }
}

// ── INSERT آمن مع تحقق فعلي ─────────────────────────────────────
export async function safeInsert(table, data) {
  const keys   = Object.keys(data);
  const vals   = Object.values(data);
  const params = keys.map((_,i) => `$${i+1}`).join(',');

  try {
    const { rows } = await pool.query(`
      INSERT INTO ${table} (${keys.join(',')})
      VALUES (${params})
      RETURNING id
    `, vals);

    if (!rows[0]?.id) throw new Error('no_id_returned');

    // تحقق فعلي
    const verify = await pool.query(`SELECT id FROM ${table} WHERE id=$1`, [rows[0].id]);
    if (verify.rows.length === 0) throw new Error('verify_failed');

    return { success: true, id: rows[0].id };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── تشغيل أي خطوة مع إصلاح تلقائي ─────────────────────────────
export async function safeStep(name, fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      return { success: true, result };
    } catch(e) {
      console.warn(`⚠️  [${name}] attempt ${i+1}: ${e.message}`);
      if (i === retries) return { success: false, error: e.message };
      await new Promise(r => setTimeout(r, 500 * (i+1)));
    }
  }
}

// ── تسجيل إلزامي في agent_execution_logs ────────────────────────
export async function logExecution(agentName, action, input, output, confidence, status) {
  try {
    const exists = await tableExists('agent_execution_logs');
    if (!exists) return;

    const conf = Math.min(100, Math.max(0, Math.round(confidence || 75)));
    await pool.query(`
      INSERT INTO agent_execution_logs
        (agent_name, action, input, output, confidence, status)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [agentName, action, JSON.stringify(input), JSON.stringify(output), conf, status]);
  } catch(_) {}
}

export { pool };
export default { ensureDir, tableExists, columnExists, safeInsert, safeStep, logExecution, pool };
