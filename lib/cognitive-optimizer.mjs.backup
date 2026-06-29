import { pool } from './db.js';

// ─────────────────────────────────────────────────────────────
// AUTONOMOUS COGNITIVE OPTIMIZER (The Self-Healing Engine)
// ─────────────────────────────────────────────────────────────

export async function runCognitiveOptimizationCycle() {
  const client = await pool.connect();
  let reRanked = 0;
  let purgedCache = 0;

  try {
    console.log('[OPTIMIZER] Starting cognitive optimization cycle...');

    // 1. Dynamic Model Re-Ranking based on recent performance (last 1 hour)
    const performanceRes = await client.query(
      `SELECT model_selected, 
              COUNT(*) as total_requests,
              AVG(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_rate,
              AVG(latency_ms) as avg_latency
       FROM routing_decisions 
       WHERE created_at > NOW() - INTERVAL '1 hour'
       GROUP BY model_selected`
    );

    for (const perf of performanceRes.rows) {
      const successRate = parseFloat(perf.success_rate || 0);
      const totalReq = parseInt(perf.total_requests || 0);

      // If a model has more than 5 requests and success rate is below 60%
      if (totalReq >= 5 && successRate < 0.6) {
        // Demote model priority
        await client.query(
          `UPDATE model_registry_sovereign 
           SET priority = priority + 1 
           WHERE model_name = $1 AND priority < 99`, // 99 is max priority (lowest rank)
          [perf.model_selected]
        );
        console.log(`[OPTIMIZER] Demoted model ${perf.model_selected} due to low success rate (${successRate * 100}%).`);
        reRanked++;
      }
      
      // Promote models with 100% success rate and low latency
      if (totalReq >= 10 && successRate === 1.0 && parseFloat(perf.avg_latency) < 1000) {
        await client.query(
          `UPDATE model_registry_sovereign 
           SET priority = GREATEST(1, priority - 1) 
           WHERE model_name = $1 AND priority > 1`,
          [perf.model_selected]
        );
        console.log(`[OPTIMIZER] Promoted model ${perf.model_selected} due to excellent performance.`);
        reRanked++;
      }
    }

    // 2. Semantic Cache Sanitization (Purge bad responses)
    // If a cached response was flagged by immune system critics, delete it
    const badCacheRes = await client.query(
      `SELECT sc.id 
       FROM semantic_cache sc
       JOIN immune_critic_evaluations ice ON ice.target_agent = 'TRUNKIA-SOVEREIGN-CACHE'
       WHERE ice.verdict ILIKE 'YES%' -- Critic found a problem
       AND ice.created_at > NOW() - INTERVAL '24 hours'`
    );

    if (badCacheRes.rows.length > 0) {
      const badIds = badCacheRes.rows.map(r => r.id);
      await client.query(`DELETE FROM semantic_cache WHERE id = ANY($1::uuid[])`, [badIds]);
      purgedCache = badIds.length;
      console.log(`[OPTIMIZER] Purged ${purgedCache} contaminated responses from Semantic Cache.`);
    }

    console.log(`[OPTIMIZER] Cycle complete. Re-ranked: ${reRanked}, Purged Cache: ${purgedCache}`);

  } catch (err) {
    console.error('[OPTIMIZER_ERROR]', err.message);
  } finally {
    client.release();
  }
}

// Self-Healing: Run every hour (3600000 ms)
setInterval(async () => {
  try {
    await runCognitiveOptimizationCycle();
  } catch (e) {
    console.error('[OPTIMIZER_INTERVAL_ERR]', e.message);
  }
}, 3600000);

// Run once on startup
runCognitiveOptimizationCycle().catch(() => {});
