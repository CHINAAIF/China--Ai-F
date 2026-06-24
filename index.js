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
import { setupGracefulShutdown } from './utils/graceful-shutdown.js';
import healthRouter from './routes/health.js';
import metricsRouter from './routes/metrics.js';
import sovereignRouter from './routes/sovereign.js';

const app  = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// ── Railway Safety: منع crash من unhandled rejections ──────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FENCE] Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FENCE] Uncaught Exception:', err.message);
});

// ── Graceful Shutdown ───────────────────────────────────────────
setupGracefulShutdown(pool);

// ── Readiness flag ──────────────────────────────────────────────
let ready = false;

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  req.pool = pool;
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-API-Version', 'v1');
  res.setHeader('X-Powered-By', 'TRUNKIA');
  next();
});

// ── Routes v1 ───────────────────────────────────────────────────
app.use('/v1/health',    healthRouter);
app.use('/v1/metrics',   metricsRouter);
app.use('/v1/sovereign', sovereignRouter);
app.use('/v1/shield', async (req, res, next) => {
  try {
    const { default: sr } = await import('./routes/shield.js');
    sr(req, res, next);
  } catch(e) {
    res.status(500).json({ error: 'shield_load_error: ' + e.message });
  }
});

// ── Geopolitical Risk API (الجديد) ─────────────────────────────
app.get('/api/intelligence/geopolitical/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const model = await pool.query(
      'SELECT id, slug, name FROM models WHERE slug = $1', [slug]
    );
    if (!model.rows.length) {
      return res.status(404).json({ error: 'Model not found', slug });
    }
    const geo = await pool.query(
      'SELECT * FROM model_geopolitical_risk WHERE model_id = $1',
      [model.rows[0].id]
    );
    if (!geo.rows.length) {
      return res.status(404).json({ error: 'No geopolitical data', slug });
    }
    const g = geo.rows[0];
    res.json({
      model: slug,
      risk_score: g.risk_score,
      country_of_origin: g.country_of_origin,
      export_restricted: g.export_restricted,
      gdpr_compliant: g.gdpr_compliant,
      can_be_blocked: g.can_be_blocked,
      blocking_regions: g.blocking_regions || [],
      government_linked: g.government_linked,
      notes: g.notes || null
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Cost Calculator API (الجديد) ───────────────────────────────
app.get('/api/intelligence/cost-calculate', async (req, res) => {
  try {
    const monthlyRequests = parseInt(req.query.requests) || 10000;
    const avgTokens = parseInt(req.query.tokens) || 1000;
    const useCase = req.query.use_case || 'general';

    const { rows } = await pool.query(`
      SELECT m.slug, m.name, pt.tier_name, pt.price,
             pt.pricing_model, pt.availability, pt.input_price, pt.output_price
      FROM model_pricing_tiers pt
      JOIN models m ON pt.model_id = m.id
      WHERE pt.active = true AND m.status = 'active'
        AND (pt.input_price > 0 OR pt.output_price > 0 OR pt.price > 0)
      ORDER BY m.slug, pt.tier_name
    `);

    const results = [];
    for (const row of rows) {
      let monthlyCost = 0;
      const totalInputTokens = monthlyRequests * avgTokens;
      const totalOutputTokens = Math.round(monthlyRequests * avgTokens * 0.3);

      if (row.pricing_model === 'per_token' || !row.pricing_model) {
        const inputCost = (row.input_price || 0) * totalInputTokens;
        const outputCost = (row.output_price || 0) * totalOutputTokens;
        monthlyCost = inputCost + outputCost;
      } else if (row.pricing_model === 'per_request') {
        monthlyCost = (row.price || 0) * monthlyRequests;
      } else if (row.pricing_model === 'subscription') {
        monthlyCost = row.price || 0;
      } else {
        monthlyCost = (row.price || 0) * monthlyRequests * avgTokens;
      }

      if (monthlyCost > 0) {
        results.push({
          slug: row.slug,
          name: row.name,
          tier: row.tier_name,
          pricing_model: row.pricing_model,
          monthly_cost_usd: Math.round(monthlyCost * 1000000) / 1000000,
          per_request_cost: Math.round((monthlyCost / monthlyRequests) * 100000000) / 100000000,
          availability: row.availability
        });
      }
    }

    results.sort((a, b) => a.monthly_cost_usd - b.monthly_cost_usd);

    res.json({
      params: { monthly_requests: monthlyRequests, avg_tokens_per_request: avgTokens, use_case: useCase },
      total_models: results.length,
      results: results.slice(0, 50)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Models Comparison API (الجديد) ─────────────────────────────
app.get('/api/intelligence/compare', async (req, res) => {
  try {
    const slugs = (req.query.models || '').split(',').filter(Boolean).slice(0, 5);
    if (slugs.length < 2) {
      return res.status(400).json({ error: 'Provide at least 2 model slugs comma-separated' });
    }

    const models = await pool.query(
      'SELECT id, slug, name, model_type, supported_languages FROM models WHERE slug = ANY($1)',
      [slugs]
    );
    if (models.rows.length < 2) {
      return res.status(404).json({ error: 'Not all models found', found: models.rows.map(m => m.slug) });
    }

    const ids = models.rows.map(m => m.id);

    const [benchmarks, capabilities, pricing, geo] = await Promise.all([
      pool.query(`
        SELECT m.slug, bd.slug as bench_slug, bd.name, mb.score, mb.percentile
        FROM model_benchmarks mb
        JOIN models m ON mb.model_id = m.id
        JOIN benchmark_definitions bd ON mb.benchmark_definition_id = bd.id
        WHERE m.id = ANY($1)
        ORDER BY bd.slug, m.slug
      `, [ids]),
      pool.query(`
        SELECT m.slug, mc.capability, mc.description
        FROM model_capabilities mc
        JOIN models m ON mc.model_id = m.id
        WHERE m.id = ANY($1)
        ORDER BY m.slug, mc.capability
      `, [ids]),
      pool.query(`
        SELECT m.slug, pt.tier_name, pt.price, pt.input_price, pt.output_price, pt.pricing_model, pt.availability
        FROM model_pricing_tiers pt
        JOIN models m ON pt.model_id = m.id
        WHERE m.id = ANY($1) AND pt.active = true
        ORDER BY m.slug
      `, [ids]),
      pool.query(`
        SELECT m.slug, gr.risk_score, gr.country_of_origin, gr.gdpr_compliant, gr.export_restricted, gr.can_be_blocked
        FROM model_geopolitical_risk gr
        JOIN models m ON gr.model_id = m.id
        WHERE m.id = ANY($1)
      `, [ids])
    ]);

    // بناء هيكل المقارنة
    const comparison = {};
    for (const m of models.rows) {
      comparison[m.slug] = {
        name: m.name,
        type: m.model_type,
        languages: m.supported_languages?.length || 0,
        benchmarks: {},
        capabilities: [],
        pricing: [],
        geopolitical: null
      };
    }

    for (const b of benchmarks.rows) {
      if (comparison[b.slug]) comparison[b.slug].benchmarks[b.bench_slug] = { name: b.name, score: b.score, percentile: b.percentile };
    }
    for (const c of capabilities.rows) {
      if (comparison[c.slug]) comparison[c.slug].capabilities.push(c.capability);
    }
    for (const p of pricing.rows) {
      if (comparison[p.slug]) comparison[p.slug].pricing.push({ tier: p.tier_name, input_price: p.input_price, output_price: p.output_price, model: p.pricing_model, availability: p.availability });
    }
    for (const g of geo.rows) {
      if (comparison[g.slug]) comparison[g.slug].geopolitical = { risk_score: g.risk_score, country: g.country_of_origin, gdpr: g.gdpr_compliant, export_restricted: g.export_restricted, blockable: g.can_be_blocked };
    }

    res.json({ models: comparison, compared: slugs });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Benchmarks Explorer API (الجديد) ───────────────────────────
app.get('/api/intelligence/benchmarks', async (req, res) => {
  try {
    const category = req.query.category;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    let query = `
      SELECT m.slug, m.name, m.model_type, bd.slug as bench_slug, bd.name as bench_name,
             bd.category, mb.score, mb.percentile
      FROM model_benchmarks mb
      JOIN models m ON mb.model_id = m.id
      JOIN benchmark_definitions bd ON mb.benchmark_definition_id = bd.id
    `;
    const params = [];
    if (category) {
      query += ' WHERE bd.category = $1';
      params.push(category);
    }
    query += ' ORDER BY bd.slug, mb.score DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const { rows } = await pool.query(query, params);

    const categories = await pool.query(
      'SELECT DISTINCT category FROM benchmark_definitions ORDER BY category'
    );

    res.json({
      categories: categories.rows.map(r => r.category),
      total_results: rows.length,
      results: rows
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Safety & Compliance API (الجديد) ───────────────────────────
app.get('/api/intelligence/safety/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const model = await pool.query('SELECT id, slug, name FROM models WHERE slug = $1', [slug]);
    if (!model.rows.length) return res.status(404).json({ error: 'Model not found' });

    const [geo, caps] = await Promise.all([
      pool.query('SELECT * FROM model_geopolitical_risk WHERE model_id = $1', [model.rows[0].id]),
      pool.query("SELECT capability FROM model_capabilities WHERE model_id = $1 AND capability IN ('streaming','function_calling','code','vision','arabic','long_context')", [model.rows[0].id])
    ]);

    const g = geo.rows[0] || {};
    const safetyCapabilities = caps.rows.map(r => r.capability);

    let trustScore = 50;
    if (g.gdpr_compliant) trustScore += 15;
    if (!g.export_restricted) trustScore += 10;
    if (!g.government_linked) trustScore += 10;
    if (safetyCapabilities.includes('function_calling')) trustScore += 5;
    if (g.risk_score <= 3) trustScore += 10;
    trustScore = Math.min(100, trustScore);

    res.json({
      model: slug,
      name: model.rows[0].name,
      trust_score: trustScore,
      geopolitical: {
        risk_score: g.risk_score || null,
        country_of_origin: g.country_of_origin || null,
        gdpr_compliant: g.gdpr_compliant || false,
        export_restricted: g.export_restricted || false,
        can_be_blocked: g.can_be_blocked || false,
        blocking_regions: g.blocking_regions || [],
        government_linked: g.government_linked || false
      },
      safety_capabilities: safetyCapabilities
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Legacy endpoints ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: ready ? 'ok' : 'starting',
  ready: ready,
  time: new Date().toISOString()
}));
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Sovereign Dashboard ──────────────────────────────────────────
app.get('/api/sovereign/dashboard', async (req, res) => {
  try {
    const [agents, heartbeat, models, ops, repairs, tasks, activity] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM agent_registry').catch(()=>({rows:[{total:108}]})),
      pool.query('SELECT status, COUNT(*) as count FROM agent_heartbeat GROUP BY status').catch(()=>({rows:[]})),
      pool.query('SELECT COUNT(*) as total FROM model_registry_sovereign').catch(()=>({rows:[{total:12}]})),
      pool.query('SELECT status, COUNT(*) as count FROM sovereign_operations GROUP BY status').catch(()=>({rows:[]})),
      pool.query('SELECT issue_severity, COUNT(*) as count FROM diagnostic_repairs GROUP BY issue_severity').catch(()=>({rows:[]})),
      pool.query('SELECT status, COUNT(*) as count FROM agent_task_queue GROUP BY status').catch(()=>({rows:[]})),
      pool.query('SELECT agent_name, status, created_at FROM agent_execution_logs ORDER BY created_at DESC LIMIT 10').catch(()=>({rows:[]}))
    ]);
    res.json({
      timestamp: new Date().toISOString(),
      system: { agents_total: agents.rows[0]?.total || 108, heartbeat_count: heartbeat.rows.length, active_models: models.rows[0]?.total || 12 },
      sovereign: { operations_count: ops.rows[0]?.ops || 0 },
      diagnostics: { repairs_count: repairs.rows[0]?.count || 0 },
      tasks: { queue_count: tasks.rows[0]?.count || 0 },
      recent_activity_count: activity.rows.length
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
      pool.query('SELECT COUNT(*) as total, SUM(usage_count) as hits, ROUND(AVG(confidence)) as avg_conf FROM sovereign_memory_local'),
      pool.query("SELECT decision, COUNT(*) as count FROM judicial_routing_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY decision"),
      pool.query("SELECT blocked, COUNT(*) as count FROM security_filter_log WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY blocked"),
      pool.query('SELECT COUNT(*) as rules FROM knowledge_distillation')
    ]);
    res.json({ timestamp: new Date().toISOString(), cache: cache.rows[0], routing: routing.rows, security: security.rows, distillation: distill.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Redundancy ───────────────────────────────────────────────────
app.get('/api/redundancy/health', async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT function_key, active_agent, failure_count, circuit_open FROM agent_redundancy_map ORDER BY failure_count DESC');
    res.json({ timestamp: new Date().toISOString(), total: rows.length, critical: rows.filter(r=>r.circuit_open), all: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Performance ──────────────────────────────────────────────────
app.get('/api/performance/scores', async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT agent_name, accuracy_score, total_runs, failed_runs, degraded FROM agent_performance_scores ORDER BY accuracy_score DESC');
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
  console.log('TRUNKIA active on port ' + PORT);
  try {
    await loadAllAgents();
    await agentSupervisor.initialize();
    setInterval(() => agentSupervisor.run({}).catch(e => console.error('[SUP] run error:', e.message)), 5 * 60000);
    startSelfHealer();
    setInterval(() => runCacheRevalidation().catch(e => console.error('[CACHE] error:', e.message)), 2 * 60 * 60000);
    setInterval(() => auditPerformance().catch(e => console.error('[PERF] error:', e.message)), 30 * 60000);
    setInterval(async () => { await runRetention().catch(()=>{}); await analyzeTablesAfterCleanup().catch(()=>{}); }, 24 * 60 * 60000);
    setInterval(() => checkAndAlert().catch(e => console.error('[ALERT] error:', e.message)), 5 * 60000);
    ready = true;
    console.log('All systems initialized');
  } catch(e) {
    console.error('Init error:', e.message);
    ready = true;
  }
});
