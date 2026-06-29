import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';

// ── تحديث Score بعد كل تشغيل ────────────────────────────────────
export async function updateScore(agentName, success, latencyMs, confidence, tokensUsed = 0) {
  try {
    const accuracyDelta = success ? +2 : -5; // عقوبة الفشل أكبر من المكافأة

    await pool.query(`
      INSERT INTO agent_performance_scores
        (agent_name, total_runs, successful_runs, failed_runs,
         avg_latency_ms, avg_confidence, accuracy_score, cost_tokens, last_run)
      VALUES ($1, 1,
        CASE WHEN $2 THEN 1 ELSE 0 END,
        CASE WHEN $2 THEN 0 ELSE 1 END,
        $3, $4, 100, $5, NOW())
      ON CONFLICT (agent_name) DO UPDATE SET
        total_runs      = agent_performance_scores.total_runs + 1,
        successful_runs = agent_performance_scores.successful_runs + CASE WHEN $2 THEN 1 ELSE 0 END,
        failed_runs     = agent_performance_scores.failed_runs + CASE WHEN $2 THEN 0 ELSE 1 END,
        avg_latency_ms  = (agent_performance_scores.avg_latency_ms + $3) / 2,
        avg_confidence  = (agent_performance_scores.avg_confidence + $4) / 2,
        accuracy_score  = GREATEST(0, LEAST(100, agent_performance_scores.accuracy_score + $6)),
        cost_tokens     = agent_performance_scores.cost_tokens + $5,
        last_run        = NOW(),
        degraded        = CASE WHEN agent_performance_scores.accuracy_score + $6 < 40 THEN true ELSE false END,
        updated_at      = NOW()
    `, [agentName, success, latencyMs, confidence, tokensUsed, accuracyDelta]);

  } catch(e) {
    console.warn(`⚠️  score update failed [${agentName}]: ${e.message}`);
  }
}

// ── جلب أفضل وكيل لوظيفة معينة ─────────────────────────────────
export async function getBestAgent(agentNames) {
  if (!agentNames?.length) return null;
  try {
    const { rows } = await pool.query(`
      SELECT agent_name, accuracy_score, avg_latency_ms, degraded
      FROM agent_performance_scores
      WHERE agent_name = ANY($1) AND degraded = false
      ORDER BY accuracy_score DESC, avg_latency_ms ASC
      LIMIT 1
    `, [agentNames]);
    return rows[0]?.agent_name || agentNames[0];
  } catch(_) {
    return agentNames[0];
  }
}

// ── تشغيل دوري: تحليل وتنبيه على الوكلاء المتدهورة ─────────────
export async function auditPerformance() {
  try {
    const { rows } = await pool.query(`
      SELECT agent_name, accuracy_score, failed_runs, total_runs
      FROM agent_performance_scores
      WHERE degraded = true OR accuracy_score < 40
      ORDER BY accuracy_score ASC
    `);

    if (rows.length > 0) {
      console.warn(`⚠️  Degraded agents: ${rows.length}`);
      for (const r of rows) {
        await pool.query(`
          INSERT INTO diagnostic_repairs
            (component, issue_type, description, auto_repaired, created_at)
          VALUES ($1,'degraded_agent',$2,false,NOW())
        `, [r.agent_name, `score=${r.accuracy_score} fails=${r.failed_runs}/${r.total_runs}`])
        .catch(()=>{});
      }
    }
    return rows;
  } catch(_) { return []; }
}

export default { updateScore, getBestAgent, auditPerformance };
