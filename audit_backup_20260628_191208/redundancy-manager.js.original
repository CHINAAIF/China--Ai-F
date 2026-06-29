import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';
import path from 'path';

const FAILURE_THRESHOLD = 3;    // عدد الفشل قبل فتح الـCircuit
const CIRCUIT_RESET_MS  = 5 * 60000; // 5 دقائق إغلاق Circuit
const EXEC_TIMEOUT_MS   = 30000;     // 30 ثانية timeout لكل وكيل

// ── cache محلي للخريطة لتجنب DB queries متكررة ──────────────────
const mapCache = new Map();
const MAP_CACHE_TTL = 60000;
let mapCacheTime = 0;

async function getRedundancyMap() {
  if (Date.now() - mapCacheTime < MAP_CACHE_TTL && mapCache.size > 0) {
    return mapCache;
  }
  try {
    const { rows } = await pool.query(`
      SELECT function_key, primary_agent, secondary_agent, tertiary_agent,
             active_agent, failure_count, circuit_open, last_failure
      FROM agent_redundancy_map
    `);
    mapCache.clear();
    for (const r of rows) mapCache.set(r.function_key, r);
    mapCacheTime = Date.now();
  } catch(_) {}
  return mapCache;
}

// ── تشغيل وكيل مع timeout صارم ──────────────────────────────────
async function execWithTimeout(agentPath, input, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT_' + timeoutMs + 'ms')), timeoutMs);
    try {
      const basePath = '/app/agents/';
      const mod = await import(basePath + agentPath + '?t=' + Date.now());
      const agent = mod.default || Object.values(mod).find(v => typeof v?.run === 'function');
      if (!agent?.run) throw new Error('NO_RUN_METHOD');
      const result = await agent.run(input);
      clearTimeout(timer);
      resolve(result);
    } catch(e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// ── تسجيل فشل وتحديث Circuit Breaker ───────────────────────────
async function recordFailure(functionKey, failedAgent, reason, fallbackAgent) {
  try {
    await pool.query(`
      UPDATE agent_redundancy_map
      SET failure_count = failure_count + 1,
          last_failure  = NOW(),
          updated_at    = NOW(),
          circuit_open  = CASE WHEN failure_count + 1 >= $1 THEN true ELSE false END,
          active_agent  = COALESCE($2, active_agent)
      WHERE function_key = $3
    `, [FAILURE_THRESHOLD, fallbackAgent, functionKey]);

    await pool.query(`
      INSERT INTO circuit_breaker_log
        (function_key, failed_agent, fallback_agent, failure_reason, circuit_opened)
      VALUES ($1,$2,$3,$4,$5)
    `, [
      functionKey, failedAgent, fallbackAgent, reason,
      false
    ]);

    await pool.query(`
      INSERT INTO diagnostic_repairs
        (component, issue_type, description, auto_repaired, created_at)
      VALUES ($1,'agent_failure',$2,true,NOW())
    `, [failedAgent, `Fallback to ${fallbackAgent}: ${reason}`]).catch(()=>{});

  } catch(_) {}
  mapCacheTime = 0; // invalidate cache
}

// ── تسجيل نجاح وإغلاق Circuit ───────────────────────────────────
async function recordSuccess(functionKey, agentPath) {
  try {
    await pool.query(`
      UPDATE agent_redundancy_map
      SET failure_count = 0,
          circuit_open  = false,
          last_success  = NOW(),
          active_agent  = $1,
          updated_at    = NOW()
      WHERE function_key = $2
    `, [agentPath, functionKey]);
  } catch(_) {}
}

// ── فحص Circuit Breaker ──────────────────────────────────────────
async function isCircuitOpen(row) {
  if (!row.circuit_open) return false;
  // فحص إذا انتهت مدة الـCooldown
  if (row.last_failure) {
    const elapsed = Date.now() - new Date(row.last_failure).getTime();
    if (elapsed > CIRCUIT_RESET_MS) {
      await pool.query(`
        UPDATE agent_redundancy_map
        SET circuit_open=false, failure_count=0, updated_at=NOW()
        WHERE function_key=$1
      `, [row.function_key]).catch(()=>{});
      return false;
    }
  }
  return true;
}

// ── الدالة الرئيسية: تشغيل بـRedundancy كامل ───────────────────
export async function executeWithRedundancy(functionKey, input = {}) {
  const map = await getRedundancyMap();
  const row = map.get(functionKey);

  if (!row) {
    // لا خريطة — تشغيل مباشر بدون redundancy
    return { success: false, error: `No redundancy map for: ${functionKey}` };
  }

  const circuitOpen = await isCircuitOpen(row);
  const agents = [
    row.primary_agent,
    row.secondary_agent,
    row.tertiary_agent
  ].filter(Boolean);

  // إذا الـCircuit مفتوح — ابدأ من الـSecondary مباشرة
  const startIdx = circuitOpen ? 1 : 0;

  for (let i = startIdx; i < agents.length; i++) {
    const agentPath = agents[i];
    const isFallback = i > 0;

    try {
      console.log(`${isFallback ? '⚡ FALLBACK' : '🚀 PRIMARY'} [${functionKey}] → ${agentPath}`);

      const result = await execWithTimeout(agentPath, input, EXEC_TIMEOUT_MS);

      if (result?.success === false) {
        throw new Error(result.error || 'agent_returned_failure');
      }

      await recordSuccess(functionKey, agentPath);

      return {
        success:   true,
        data:      result?.data || result,
        agent:     agentPath,
        fallback:  isFallback,
        tier:      i === 0 ? 'primary' : i === 1 ? 'secondary' : 'tertiary'
      };

    } catch(e) {
      const nextAgent = agents[i + 1] || null;
      console.warn(`❌ [${functionKey}] ${agentPath} failed: ${e.message} → ${nextAgent || 'NO_MORE_AGENTS'}`);
      await recordFailure(functionKey, agentPath, e.message, nextAgent);

      if (!nextAgent) {
        // كل الوكلاء فشلوا — تنبيه كارثي
        await pool.query(`
          INSERT INTO diagnostic_repairs
            (component, issue_type, description, auto_repaired, created_at)
          VALUES ($1,'CRITICAL_ALL_FAILED',$2,false,NOW())
        `, [functionKey, `ALL agents failed for ${functionKey}`]).catch(()=>{});

        console.error(`🚨 CRITICAL: All agents failed for [${functionKey}]`);
        return { success: false, error: 'ALL_AGENTS_FAILED', function: functionKey };
      }
    }
  }

  return { success: false, error: 'EXHAUSTED', function: functionKey };
}

// ── Health Check للـRedundancy Map ──────────────────────────────
export async function getRedundancyHealth() {
  try {
    const { rows } = await pool.query(`
      SELECT function_key, active_agent, failure_count,
             circuit_open, last_success, last_failure
      FROM agent_redundancy_map
      ORDER BY failure_count DESC
    `);
    return rows;
  } catch(_) { return []; }
}

export default { executeWithRedundancy, getRedundancyHealth };
