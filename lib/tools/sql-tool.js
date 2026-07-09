/**
 * TRUNKIA Unified Secure SQL Tool
 * Combines Constitution (Policy) + Sovereign Kernel (Crypto) in one fast pass.
 */
import { getPool } from '../db.js';
import { sanitizeDataAccess } from '../crypto-binding.js';
import { constitutionEngine } from '../constitution-engine.js';
import { sovereignKernel } from '../sovereign-kernel.js';

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

export async function queryData(sql, params = [], poolName = 'main', agentName = 'unknown', userId = null, intent = {}) {
  const start = process.hrtime.bigint(); // مقياس دقيق بالنانوثانية
  
  try {
    // 1. فحص أمني سريع
    validateQuery(sql, params);
    
    // 2. تقييم الدستور (Policy Check)
    const fullIntent = { ...intent, agentName, userId, sql, params, action: 'read_data', layer: intent.layer || 'analysis', table: intent.table || null };
    const constitutionResult = constitutionEngine.evaluate(fullIntent);
    if (!constitutionResult.allowed) {
      throw new Error(`CONSTITUTION VIOLATION: ${constitutionResult.violations.map(v => v.rule).join(', ')}`);
    }

    // 3. إصدار رمز القدرة (Kernel Token)
    const token = sovereignKernel.issueCapability({ sql, params, userId, agentName });
    
    // 4. التحقق من الرمز وحرقه (Verify & Burn) - يتم محلياً في أجزاء من الملي ثانية
    const kernelCheck = sovereignKernel.verifyAndBurnCapability(token, { sql, params, userId, agentName });
    if (!kernelCheck.valid) {
      throw new Error(`KERNEL DENIED: ${kernelCheck.error}`);
    }

    // 5. تنفيذ الاستعلام الفعلي (هنا يحدث زمن الشبكة الحقيقي)
    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    
    // 6. التحقق التشفيري من ملكية البيانات
    const safeRows = userId ? sanitizeDataAccess(userId, result.rows) : result.rows;
    
    const latency_ms = Number(process.hrtime.bigint() - start) / 1e6; // تحويل لمللي ثانية
    
    return {
      success: true,
      rows: safeRows,
      rowCount: safeRows.length,
      latency_ms: parseFloat(latency_ms.toFixed(2)),
      constitutional_hash: constitutionResult.constitutionalHash
    };
    
  } catch (err) {
    const latency_ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { success: false, error: err.message, rows: [], rowCount: 0, latency_ms: parseFloat(latency_ms.toFixed(2)) };
  }
}

export async function mutateData(sql, params = [], poolName = 'main', agentName = 'unknown', userId = null, intent = {}) {
  // نفس المنطق ولكن للكتابة
  const start = process.hrtime.bigint();
  try {
    validateQuery(sql, params);
    const fullIntent = { ...intent, agentName, userId, sql, params, action: 'execute_sql_write', layer: intent.layer || 'governance' };
    
    const constitutionResult = constitutionEngine.evaluate(fullIntent);
    if (!constitutionResult.allowed) throw new Error(`CONSTITUTION VIOLATION: ${constitutionResult.violations.map(v => v.rule).join(', ')}`);
    
    const token = sovereignKernel.issueCapability({ sql, params, userId, agentName });
    const kernelCheck = sovereignKernel.verifyAndBurnCapability(token, { sql, params, userId, agentName });
    if (!kernelCheck.valid) throw new Error(`KERNEL DENIED: ${kernelCheck.error}`);

    const pool = getPool(poolName);
    const result = await pool.query(sql, params);
    const latency_ms = Number(process.hrtime.bigint() - start) / 1e6;
    
    return { success: true, rows: result.rows, rowCount: result.rowCount, latency_ms: parseFloat(latency_ms.toFixed(2)) };
  } catch (err) {
    const latency_ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { success: false, error: err.message, rows: [], rowCount: 0, latency_ms: parseFloat(latency_ms.toFixed(2)) };
  }
}
