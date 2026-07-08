/**
 * TRUNKIA Unified SQL Tool
 * إصلاح أمني: blacklist نصي بسيط (DROP/TRUNCATE...) قابل للالتفاف عبر
 * تعليقات SQL أو تقسيم الكلمة. الحل: whitelist صريح لأسماء الجداول
 * المسموح بها لكل عملية، بدل محاولة تخمين الأنماط الخطرة.
 */
import { getPool } from '../db.js';

// جداول يُسمح بالكتابة عليها عبر هذه الأداة فقط - أي جدول غير مذكور هنا مرفوض تلقائياً
const MUTATE_ALLOWED_TABLES = [
  'agent_execution_logs', 'learning_candidates', 'user_preferences'
  // أضف فقط الجداول التي تحتاج فعلياً كتابة من الوكلاء عبر هذه الأداة
];

function validateQuery(sql, params = []) {
  const trimmed = sql.trim();
  const upperSql = trimmed.toUpperCase();

  // منع أكثر من عبارة واحدة تماماً: أي ';' غير الأخيرة (إن وجدت) مرفوض
  const semicolons = trimmed.replace(/;$/, '').includes(';');
  if (semicolons) throw new Error('SECURITY: Multiple statements not allowed');

  const forbidden = ['DROP', 'TRUNCATE', 'ALTER', 'GRANT', 'REVOKE', 'CREATE', 'COMMENT'];
  // فحص بالكلمة الكاملة (word boundary) لا substring، يقلل بعض الالتفافات لكن يبقى دفاعاً ثانوياً فقط
  for (const keyword of forbidden) {
    if (new RegExp(`\\b${keyword}\\b`).test(upperSql)) {
      throw new Error(`SECURITY: Forbidden keyword "${keyword}"`);
    }
  }

  const paramCount = (sql.match(/\$\d+/g) || []).length;
  if (paramCount !== params.length) throw new Error('SECURITY: Parameter mismatch');
  return true;
}

// استخراج اسم الجدول الأول بعد UPDATE/INSERT INTO - فحص إضافي حقيقي (whitelist)
function extractTargetTable(sql) {
  const m = sql.trim().match(/^(?:UPDATE|INSERT\s+INTO)\s+["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/i);
  return m ? m[1].toLowerCase() : null;
}

export async function queryData(sql, params = [], poolName = 'main', agentName = 'unknown') {
  try {
    validateQuery(sql, params);
    const upper = sql.toUpperCase().trim();
    if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
      throw new Error('SECURITY: queryData only supports SELECT');
    }
    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    return { success: true, rows: result.rows, rowCount: result.rowCount };
  } catch (err) {
    return { success: false, error: err.message, rows: [] };
  }
}

export async function mutateData(sql, params = [], poolName = 'main', agentName = 'unknown') {
  try {
    validateQuery(sql, params);
    const upper = sql.toUpperCase().trim();
    if (!upper.startsWith('INSERT') && !upper.startsWith('UPDATE')) {
      throw new Error('SECURITY: mutateData only supports INSERT/UPDATE');
    }

    // فحص whitelist حقيقي - الإضافة الأهم هنا
    const targetTable = extractTargetTable(sql);
    if (!targetTable || !MUTATE_ALLOWED_TABLES.includes(targetTable)) {
      throw new Error(`SECURITY: Table "${targetTable}" not in mutateData whitelist. Agent: ${agentName}`);
    }

    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    return { success: true, rows: result.rows, rowCount: result.rowCount };
  } catch (err) {
    return { success: false, error: err.message, rows: [] };
  }
}
