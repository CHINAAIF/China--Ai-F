import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';
import { agentSupervisor } from './agents/governance/agent-supervisor.js';
import { startSelfHealer } from './agents/utils/self-healer.js';
import { checkAndAlert } from './agents/utils/alert-engine.js';
import { runCacheRevalidation } from './agents/utils/gateway-sentinel.js';
import { runRetention, analyzeTablesAfterCleanup } from './agents/utils/data-retention.js';
import { auditPerformance } from './agents/utils/performance-scorer.js';
import { loadAllAgents } from './agents/registry.js';
import healthRouter from './routes/health.js';
import metricsRouter from './routes/metrics.js';
import sovereignRouter from './routes/sovereign.js';
// shield loaded lazily below

const app  = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-API-Version', 'v1');
  res.setHeader('X-Powered-By', 'TRUNKIA');
  next();
});

// ── Routes v1 ───────────────────────────────────────────────────
app.use('/v1/health',    healthRouter);
app.use('/v1/metrics',   metricsRouter);
app.use('/v1/sovereign', sovereignRouter);
app.use('/v1/shield', async (req, res, next) => { try { const { default: sr } = await import('./routes/shield.js'); sr(req, res, next); } catch(e) { res.status(500).json({ error: 'shield_load_error: ' + e.message }); } });

// ── Legacy endpoints ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/ping',   (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Sovereign Dashboard ──────────────────────────────────────────
app.get('/api/sovereign/dashboard', async (req, res) => {
  try {
    const [agents, heartbeat, models, ops, repairs, tasks, activity] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM agent_registry`).catch(()=>({rows:[{total:108}]})),
      pool.query(`SELECT status, COUNT(*) as count FROM agent_heartbeat GROUP BY status`).catch(()=>({rows:[]})),
      pool.query(`SELECT COUNT(*) as total FROM model_registry_sovereign`).catch(()=>({rows:[{total:12}]})),
      pool.query(`SELECT status, COUNT(*) as count FROM sovereign_operations GROUP BY status`).catch(()=>({rows:[]})),
      pool.query(`SELECT issue_severity, COUNT(*) as count FROM diagnostic_repairs GROUP BY issue_severity`).catch(()=>({rows:[]})),
      pool.query(`SELECT status, COUNT(*) as count FROM agent_task_queue GROUP BY status`).catch(()=>({rows:[]})),
      pool.query(`SELECT agent_name, status, created_at FROM agent_execution_logs ORDER BY created_at DESC LIMIT 10`).catch(()=>({rows:[]})),
    ]);
    res.json({
      timestamp: new Date().toISOString(),
      system: { agents_total: agents.rows[0]?.total || 108, heartbeat: heartbeat.rows, active_models: models.rows[0]?.total || 12 },
      sovereign: { operations: ops.rows },
      diagnostics: { repairs: repairs.rows },
      tasks: { queue: tasks.rows },
      recent_activity: activity.rows
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Supervision ──────────────────────────────────────────────────
app.get('/api/supervision/health', async (req, res) => {
  try {
    const r = await agentSupervisor.runDiagnostic();
    res.json({ timestamp: new Date().toISOString(), ...r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Judicial Stats ───────────────────────────────────────────────
app.get('/api/judicial/stats', async (req, res) => {
  try {
    const [cache, routing, security, distill] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, SUM(usage_count) as hits, ROUND(AVG(confidence)) as avg_conf FROM sovereign_memory_local`),
      pool.query(`SELECT decision, COUNT(*) as count FROM judicial_routing_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY decision`),
      pool.query(`SELECT blocked, COUNT(*) as count FROM security_filter_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY blocked`),
      pool.query(`SELECT COUNT(*) as rules FROM knowledge_distillation`)
    ]);
    res.json({ timestamp: new Date().toISOString(), cache: cache.rows[0], routing: routing.rows, security: security.rows, distillation: distill.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Redundancy ───────────────────────────────────────────────────
app.get('/api/redundancy/health', async (req, res) => {
  try {
    const {rows} = await pool.query(`SELECT function_key, active_agent, failure_count, circuit_open FROM agent_redundancy_map ORDER BY failure_count DESC`);
    res.json({ timestamp: new Date().toISOString(), total: rows.length, critical: rows.filter(r=>r.circuit_open), all: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Performance ──────────────────────────────────────────────────
app.get('/api/performance/scores', async (req, res) => {
  try {
    const {rows} = await pool.query(`SELECT agent_name, accuracy_score, total_runs, failed_runs, degraded FROM agent_performance_scores ORDER BY accuracy_score DESC`);
    res.json({ timestamp: new Date().toISOString(), total: rows.length, agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not Found', request_id: req.requestId }));

// ── Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled:', err.message);
  res.status(500).json({ error: 'Internal Error', request_id: req.requestId });
});

// ── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ TRUNKIA active on port ${PORT}`);
  try {
    await loadAllAgents();
    await agentSupervisor.initialize();
    setInterval(() => agentSupervisor.run({}), 5 * 60000);
    startSelfHealer();
    setInterval(runCacheRevalidation, 2 * 60 * 60000);
    setInterval(auditPerformance, 30 * 60000);
    setInterval(async () => { await runRetention(); await analyzeTablesAfterCleanup(); }, 24 * 60 * 60000);
    setInterval(checkAndAlert, 5 * 60000);
    console.log('✅ All systems initialized');
  } catch(e) {
    console.error('Init error:', e.message);
  }
});
