import express from 'express';
import pg from 'pg';
const router = express.Router();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

router.get('/performance', async (req, res) => {
  try {
    const {rows} = await pool.query(`
      SELECT agent_name,accuracy_score,total_runs,failed_runs,avg_latency_ms,degraded,last_run
      FROM agent_performance_scores ORDER BY accuracy_score DESC
    `);
    res.json({ timestamp: new Date().toISOString(), total: rows.length, agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/costs', async (req, res) => {
  try {
    const {rows} = await pool.query(`
      SELECT agent_name,
             SUM(tokens_in+tokens_out) as total_tokens,
             SUM(cost_usd) as total_cost_usd,
             COUNT(*) as calls
      FROM cost_tracking
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY agent_name ORDER BY total_cost_usd DESC LIMIT 20
    `);
    res.json({ timestamp: new Date().toISOString(), period: '24h', agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/judicial', async (req, res) => {
  try {
    const [cache,routing,security,distill] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, SUM(usage_count) as hits, ROUND(AVG(confidence)) as avg_conf FROM sovereign_memory_local`),
      pool.query(`SELECT decision, COUNT(*) as count, ROUND(AVG(latency_ms)) as avg_ms FROM judicial_routing_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY decision ORDER BY count DESC`),
      pool.query(`SELECT blocked, COUNT(*) as count FROM security_filter_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY blocked`),
      pool.query(`SELECT COUNT(*) as rules, COUNT(*) FILTER(WHERE is_permanent) as permanent FROM knowledge_distillation`)
    ]);
    res.json({ timestamp: new Date().toISOString(), cache: cache.rows[0], routing: routing.rows, security: security.rows, distillation: distill.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/redundancy', async (req, res) => {
  try {
    const {rows} = await pool.query(`
      SELECT function_key, active_agent, failure_count, circuit_open, last_success, last_failure
      FROM agent_redundancy_map ORDER BY failure_count DESC
    `);
    res.json({ timestamp: new Date().toISOString(), total: rows.length, critical: rows.filter(r=>r.circuit_open), all: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/sentinel', async (req, res) => {
  try {
    const [mem,blocked] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE valid_until>NOW()) as valid, ROUND(AVG(confidence)) as avg_conf FROM sovereign_memory_local`),
      pool.query(`SELECT COUNT(*) as blocked FROM security_filter_log WHERE blocked=true AND created_at > NOW() - INTERVAL '24 hours'`)
    ]);
    res.json({ timestamp: new Date().toISOString(), hmac_active: true, token_ttl_ms: 5000, cache: mem.rows[0], blocked_24h: blocked.rows[0].blocked });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

export default router;
