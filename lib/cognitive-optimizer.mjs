import { pool } from './db.js';
import { setImmediate } from 'timers';

// ═══════════════════════════════════════════════════════════════
// TRUNKIA SOVEREIGN COGNITIVE OPTIMIZER v2.0
// Non-Blocking | Circuit Breaker | Self-Healing | Anti-Fragile
// ═══════════════════════════════════════════════════════════════

const DB_TIMEOUT_MS = 8000;
const OPTIMIZER_INTERVAL_MS = 3600000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 300000;

// ── CIRCUIT BREAKER ─────────────────────────────────────────────
const circuitBreaker = {
  failures: 0,
  state: 'CLOSED',
  lastFailure: null,
  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
        this.state = 'HALF_OPEN';
        console.log('[CIRCUIT_BREAKER] State: HALF_OPEN — testing recovery');
        return false;
      }
      return true;
    }
    return false;
  },
  recordSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  },
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state = 'OPEN';
      console.error(`[CIRCUIT_BREAKER] State: OPEN — optimizer suspended for ${CIRCUIT_BREAKER_RESET_MS / 60000} minutes`);
    }
  }
};

// ── DB QUERY WITH TIMEOUT ────────────────────────────────────────
async function safeQuery(client, query, params = []) {
  return Promise.race([
    client.query(query, params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('QUERY_TIMEOUT')), DB_TIMEOUT_MS)
    )
  ]);
}

// ── SAFE DB CONNECT ──────────────────────────────────────────────
async function safeConnect() {
  return Promise.race([
    pool.connect(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), DB_TIMEOUT_MS)
    )
  ]);
}

// ── MODEL PERFORMANCE OPTIMIZER ──────────────────────────────────
async function optimizeModelRanking(client) {
  let reRanked = 0;
  try {
    const res = await safeQuery(client,
      `SELECT model_selected,
              COUNT(*) as total_requests,
              AVG(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_rate,
              AVG(latency_ms) as avg_latency
       FROM routing_decisions
       WHERE created_at > NOW() - INTERVAL '1 hour'
       GROUP BY model_selected`
    );

    for (const perf of res.rows) {
      const successRate = parseFloat(perf.success_rate || 0);
      const totalReq = parseInt(perf.total_requests || 0);
      const avgLatency = parseFloat(perf.avg_latency || 9999);

      if (totalReq >= 5 && successRate < 0.6) {
        await safeQuery(client,
          `UPDATE model_registry_sovereign
           SET priority = priority + 1
           WHERE model_name = $1 AND priority < 99`,
          [perf.model_selected]
        );
        reRanked++;
      }

      if (totalReq >= 10 && successRate === 1.0 && avgLatency < 1000) {
        await safeQuery(client,
          `UPDATE model_registry_sovereign
           SET priority = GREATEST(1, priority - 1)
           WHERE model_name = $1 AND priority > 1`,
          [perf.model_selected]
        );
        reRanked++;
      }
    }
  } catch (e) {
    console.error('[OPTIMIZER] Model ranking error:', e.message);
  }
  return reRanked;
}

// ── SEMANTIC CACHE SANITIZER ─────────────────────────────────────
async function sanitizeSemanticCache(client) {
  let purgedCache = 0;
  try {
    const res = await safeQuery(client,
      `SELECT sc.id
       FROM semantic_cache sc
       JOIN immune_critic_evaluations ice ON ice.target_agent = 'TRUNKIA-SOVEREIGN-CACHE'
       WHERE ice.verdict ILIKE 'YES%'
       AND ice.created_at > NOW() - INTERVAL '24 hours'`
    );

    if (res.rows.length > 0) {
      const ids = res.rows.map(r => r.id);
      await safeQuery(client,
        `DELETE FROM semantic_cache WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      purgedCache = ids.length;
    }
  } catch (e) {
    if (!e.message.includes('does not exist')) {
      console.error('[OPTIMIZER] Cache sanitize error:', e.message);
    }
  }
  return purgedCache;
}

// ── SESSION RISK CLEANER ─────────────────────────────────────────
async function cleanExpiredSessions(client) {
  try {
    await safeQuery(client,
      `DELETE FROM session_risk_tracker
       WHERE updated_at < NOW() - INTERVAL '24 hours'`
    );
  } catch (e) {
    if (!e.message.includes('does not exist')) {
      console.error('[OPTIMIZER] Session cleanup error:', e.message);
    }
  }
}

// ── NONCE VAULT CLEANER ──────────────────────────────────────────
async function cleanExpiredNonces(client) {
  try {
    await safeQuery(client,
      `DELETE FROM agent_nonce_vault
       WHERE expires_at < NOW()`
    );
  } catch (e) {
    if (!e.message.includes('does not exist')) {
      console.error('[OPTIMIZER] Nonce cleanup error:', e.message);
    }
  }
}

// ── AGENT HEALTH MONITOR ─────────────────────────────────────────
async function monitorAgentHealth(client) {
  try {
    await safeQuery(client,
      `UPDATE agent_registry
       SET status = 'degraded'
       WHERE last_heartbeat < NOW() - INTERVAL '10 minutes'
       AND status = 'active'`
    );
  } catch (e) {
    if (!e.message.includes('does not exist')) {
      console.error('[OPTIMIZER] Agent health error:', e.message);
    }
  }
}

// ── MAIN OPTIMIZER CYCLE ─────────────────────────────────────────
export async function runCognitiveOptimizationCycle() {
  if (circuitBreaker.isOpen()) {
    console.warn('[OPTIMIZER] Circuit OPEN — skipping cycle');
    return;
  }

  let client;
  try {
    client = await safeConnect();

    console.log('[OPTIMIZER] Starting cognitive optimization cycle...');

    const [reRanked, purgedCache] = await Promise.all([
      optimizeModelRanking(client),
      sanitizeSemanticCache(client)
    ]);

    // Non-critical cleanups — run sequentially, non-blocking
    setImmediate(async () => {
      let c;
      try {
        c = await safeConnect();
        await cleanExpiredSessions(c);
        await cleanExpiredNonces(c);
        await monitorAgentHealth(c);
      } catch (e) {
        console.error('[OPTIMIZER] Cleanup error:', e.message);
      } finally {
        if (c) c.release();
      }
    });

    circuitBreaker.recordSuccess();
    console.log(`[OPTIMIZER] Cycle complete. Re-ranked: ${reRanked}, Purged Cache: ${purgedCache}`);

  } catch (err) {
    circuitBreaker.recordFailure();
    console.error('[OPTIMIZER_ERROR]', err.message);
  } finally {
    if (client) client.release();
  }
}

// ── SCHEDULER — NON-BLOCKING ─────────────────────────────────────
let optimizerRunning = false;

function scheduleNextCycle() {
  setTimeout(async () => {
    if (optimizerRunning) {
      console.warn('[OPTIMIZER] Previous cycle still running — skipping');
      scheduleNextCycle();
      return;
    }
    optimizerRunning = true;
    try {
      await runCognitiveOptimizationCycle();
    } finally {
      optimizerRunning = false;
      scheduleNextCycle();
    }
  }, OPTIMIZER_INTERVAL_MS);
}

// ── STARTUP ──────────────────────────────────────────────────────
setImmediate(async () => {
  try {
    await runCognitiveOptimizationCycle();
  } catch (e) {
    console.error('[OPTIMIZER_STARTUP_ERR]', e.message);
  } finally {
    scheduleNextCycle();
  }
});
