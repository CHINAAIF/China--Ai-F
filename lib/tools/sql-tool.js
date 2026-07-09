/**
 * TRUNKIA Unified SQL Tool
 * يجمع بين: منع حقن SQL، وعزل الصفوف تشفيرياً (Crypto Binding).
 */
import { getPool } from '../db.js';
import { sanitizeDataAccess } from '../crypto-binding.js';

const FORBIDDEN_KEYWORDS = ['DROP', 'TRUNCATE', 'ALTER', 'GRANT', 'REVOKE'];

function validateQuery(sql, params = []) {
  const upperSql = sql.toUpperCase().trim();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (upperSql.includes(keyword)) throw new Error(`SECURITY: Forbidden keyword "${keyword}"`);
  }
  if (sql.includes(';') && !sql.trim().endsWith(';')) throw new Error('SECURITY: Multiple statements');
  const paramCount = (sql.match(/\$\d+/g) || []).length;
  if (paramCount !== params.length) throw new Error('SECURITY: Parameter mismatch');
  return true;
}

/**
 * تنفيذ استعلام قراءة (SELECT) مع فحص تشفيري للنتائج
 */
export async function queryData(sql, params = [], poolName = 'main', agentName = 'unknown', userId = null) {
  const start = Date.now();
  try {
    validateQuery(sql, params);
    if (!sql.toUpperCase().trim().startsWith('SELECT') && !sql.toUpperCase().trim().startsWith('WITH')) {
      throw new Error('SECURITY: queryData only supports SELECT');
    }
    
    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    
    // التحقق التشفيري من ملكية البيانات قبل إرجاعها للوكيل
    // إذا كان الـ userId متوفراً، يتم فلترة أي صف لا يملك عليه توقيعاً صحيحاً
    const safeRows = userId ? sanitizeDataAccess(userId, result.rows) : result.rows;
    
    const latency = Date.now() - start;
    if (latency > 500) {
      console.warn(`[SQL-TOOL] SLOW QUERY by ${agentName} (${latency}ms)`);
    }
    
    return {
      success: true,
      rows: safeRows,
      rowCount: safeRows.length,
      latency_ms: latency
    };
    
  } catch (err) {
    console.error(`[SQL-TOOL] Error by ${agentName}:`, err.message);
    return { success: false, error: err.message, rows: [], rowCount: 0, latency_ms: Date.now() - start };
  }
}

/**
 * تنفيذ استعلام كتابة (INSERT/UPDATE)
 */
export async function mutateData(sql, params = [], poolName = 'main', agentName = 'unknown') {
  const start = Date.now();
  try {
    validateQuery(sql, params);
    if (!sql.toUpperCase().trim().startsWith('INSERT') && !sql.toUpperCase().trim().startsWith('UPDATE')) {
      throw new Error('SECURITY: mutateData only supports INSERT/UPDATE');
    }
    
    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    
    const latency = Date.now() - start;
    console.log(`[SQL-TOOL] MUTATE by ${agentName} (${latency}ms): rows affected=${result.rowCount}`);
    
    return {
      success: true,
      rows: result.rows,
      rowCount: result.rowCount,
      latency_ms: latency
    };
    
  } catch (err) {
    console.error(`[SQL-TOOL] MUTATE Error by ${agentName}:`, err.message);
    return { success: false, error: err.message, rows: [], rowCount: 0, latency_ms: Date.now() - start };
  }
}
