/**
 * TRUNKIA Unified SQL Tool
 */
import { getPool } from '../db.js';

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

export async function queryData(sql, params = [], poolName = 'main', agentName = 'unknown') {
  try {
    validateQuery(sql, params);
    if (!sql.toUpperCase().trim().startsWith('SELECT') && !sql.toUpperCase().trim().startsWith('WITH')) {
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
    if (!sql.toUpperCase().trim().startsWith('INSERT') && !sql.toUpperCase().trim().startsWith('UPDATE')) {
      throw new Error('SECURITY: mutateData only supports INSERT/UPDATE');
    }
    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    return { success: true, rows: result.rows, rowCount: result.rowCount };
  } catch (err) {
    return { success: false, error: err.message, rows: [] };
  }
}
