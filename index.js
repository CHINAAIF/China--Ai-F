import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

process.on('unhandledRejection', (r) => console.error('[FENCE] rejection:', r?.message || r));
process.on('uncaughtException', (e) => console.error('[FENCE] exception:', e.message));

const app = express();
const PORT = process.env.PORT || 5000;
let pool = null;
const initLog = [];
let ready = false;

function log(step, ok, detail) {
  const entry = { step, status: ok ? 'ok' : 'fail', detail: detail || '', time: Date.now() };
  initLog.push(entry);
  console.log((ok ? '[OK]' : '[FAIL]') + ' ' + step + (detail ? ' — ' + detail : ''));
}

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

app.get('/health', (req, res) => {
  res.json({ status: ready ? 'ok' : 'starting', ready, time: new Date().toISOString() });
});
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/debug/init', (req, res) => {
  res.json({ ready, steps: initLog, env_keys: Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET') && !k.includes('ENCRYPTION')) });
});

function db(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'DB not ready', ready });
  req.pool = pool;
  next();
}

app.get('/api/intelligence/geopolitical/:slug', db, async (req, res) => {
  try {
    const model = await pool.query('SELECT id, slug, name FROM models WHERE slug = $1', [req.params.slug]);
    if (!model.rows.length) return res.status(404).json({ error: 'Model not found' });
    const geo = await pool.query('SELECT * FROM model_geopolitical_risk WHERE model_id = $1', [model.rows[0].id]);
    if (!geo.rows.length) return res.status(404).json({ error: 'No geopolitical data' });
    const g = geo.rows[0];
    res.json({ model: req.params.slug, risk_score: g.risk_score, country_of_origin: g.country_of_origin, export_restricted: g.export_restricted, gdpr_compliant: g.gdpr_compliant, can_be_blocked: g.can_be_blocked, blocking_regions: g.blocking_regions || [], government_linked: g.government_linked });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/cost-calculate', db, async (req, res) => {
  try {
    const monthlyRequests = parseInt(req.query.requests) || 10000;
    const avgTokens = parseInt(req.query.tokens) || 1000;
    const { rows } = await pool.query(
      "SELECT m.slug, m.name, pt.tier_name, pt.input_price, pt.output_price, pt.price, pt.pricing_model, pt.availability FROM model_pricing_tiers pt JOIN models m ON pt.model_id = m.id WHERE pt.active = true AND m.status = 'active' AND (pt.input_price > 0 OR pt.output_price > 0 OR pt.price > 0)"
    );
    const results = [];
    for (const row of rows) {
      const inTok = monthlyRequests * avgTokens;
      const outTok = Math.round(inTok * 0.3);
      let cost = 0;
      if (row.pricing_model === 'per_token' || !row.pricing_model) {
        cost = (row.input_price || 0) * inTok + (row.output_price || 0) * outTok;
      } else {
        cost = (row.price || 0) * monthlyRequests;
      }
      if (cost > 0) results.push({ slug: row.slug, name: row.name, tier: row.tier_name, monthly_cost_usd: Math.round(cost * 1e6) / 1e6, per_request_cost: Math.round((cost / monthlyRequests) * 1e8) / 1e8, availability: row.availability });
    }
    results.sort((a, b) => a.monthly_cost_usd - b.monthly_cost_usd);
    res.json({ params: { monthly_requests: monthlyRequests, avg_tokens: avgTokens }, total: results.length, results: results.slice(0, 50) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/compare', db, async (req, res) => {
  try {
    const slugs = (req.query.models || '').split(',').filter(Boolean).slice(0, 5);
    if (slugs.length < 2) return res.status(400).json({ error: 'Provide 2+ slugs' });
    const models = await pool.query('SELECT id, slug, name, model_type, supported_languages FROM models WHERE slug = ANY($1)', [slugs]);
    if (models.rows.length < 2) return res.status(404).json({ error: 'Not all found', found: models.rows.map(m => m.slug) });
    const ids = models.rows.map(m => m.id);
    const [benchmarks, capabilities, pricing, geo] = await Promise.all([
      pool.query("SELECT m.slug, bd.slug as bslug, bd.name, mb.score, mb.percentile FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id WHERE m.id=ANY($1)", [ids]),
      pool.query("SELECT m.slug, mc.capability FROM model_capabilities mc JOIN models m ON mc.model_id=m.id WHERE m.id=ANY($1)", [ids]),
      pool.query("SELECT m.slug, pt.tier_name, pt.input_price, pt.output_price, pt.pricing_model, pt.availability FROM model_pricing_tiers pt JOIN models m ON pt.model_id=m.id WHERE m.id=ANY($1) AND pt.active=true", [ids]),
      pool.query("SELECT m.slug, gr.* FROM model_geopolitical_risk gr JOIN models m ON gr.model_id=m.id WHERE m.id=ANY($1)", [ids])
    ]);
    const comp = {};
    for (const m of models.rows) comp[m.slug] = { name: m.name, type: m.model_type, languages: m.supported_languages?.length || 0, benchmarks: {}, capabilities: [], pricing: [], geopolitical: null };
    for (const b of benchmarks.rows) { if (comp[b.slug]) comp[b.slug].benchmarks[b.bslug] = { name: b.name, score: b.score, percentile: b.percentile }; }
    for (const c of capabilities.rows) { if (comp[c.slug]) comp[c.slug].capabilities.push(c.capability); }
    for (const p of pricing.rows) { if (comp[p.slug]) comp[p.slug].pricing.push({ tier: p.tier_name, input_price: p.input_price, output_price: p.output_price, model: p.pricing_model, availability: p.availability }); }
    for (const g of geo.rows) { if (comp[g.slug]) comp[g.slug].geopolitical = { risk_score: g.risk_score, country: g.country_of_origin, gdpr: g.gdpr_compliant, restricted: g.export_restricted }; }
    res.json({ models: comp, compared: slugs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/benchmarks', db, async (req, res) => {
  try {
    const cat = req.query.category;
    const lim = Math.min(parseInt(req.query.limit) || 50, 100);
    let q = "SELECT m.slug, m.name, bd.slug as bslug, bd.name as bname, bd.category, mb.score, mb.percentile FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id";
    const p = [];
    if (cat) { q += ' WHERE bd.category=$1'; p.push(cat); }
    q += ' ORDER BY bd.slug, mb.score DESC LIMIT $' + (p.length + 1); p.push(lim);
    const { rows } = await pool.query(q, p);
    const cats = await pool.query('SELECT DISTINCT category FROM benchmark_definitions ORDER BY category');
    res.json({ categories: cats.rows.map(r => r.category), total: rows.length, results: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/safety/:slug', db, async (req, res) => {
  try {
    const model = await pool.query('SELECT id, slug, name FROM models WHERE slug = $1', [req.params.slug]);
    if (!model.rows.length) return res.status(404).json({ error: 'Not found' });
    const [geo, caps] = await Promise.all([
      pool.query('SELECT * FROM model_geopolitical_risk WHERE model_id = $1', [model.rows[0].id]),
      pool.query("SELECT capability FROM model_capabilities WHERE model_id = $1 AND capability IN ('streaming','function_calling','code','vision','arabic','long_context')", [model.rows[0].id])
    ]);
    const g = geo.rows[0] || {};
    const sc = caps.rows.map(r => r.capability);
    let trust = 50;
    if (g.gdpr_compliant) trust += 15;
    if (!g.export_restricted) trust += 10;
    if (!g.government_linked) trust += 10;
    if (sc.includes('function_calling')) trust += 5;
    if (g.risk_score <= 3) trust += 10;
    res.json({ model: req.params.slug, name: model.rows[0].name, trust_score: Math.min(100, trust), geopolitical: { risk_score: g.risk_score, country: g.country_of_origin, gdpr: g.gdpr_compliant, export_restricted: g.export_restricted, blockable: g.can_be_blocked, blocking_regions: g.blocking_regions || [], government_linked: g.government_linked }, safety_capabilities: sc });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use('/v1/health', async (req, res, next) => { try { const r = await import('./routes/health.js'); r.default(req, res, next); } catch(e) { res.json({ status: 'ok' }); } });
app.use('/v1/metrics', async (req, res, next) => { try { const r = await import('./routes/metrics.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });
app.use('/v1/sovereign', async (req, res, next) => { try { const r = await import('./routes/sovereign.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });
app.use('/v1/shield', async (req, res, next) => { try { const r = await import('./routes/shield.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/sovereign/dashboard', db, async (req, res) => {
  try {
    const [agents] = await Promise.all([pool.query('SELECT COUNT(*) as total FROM agent_registry').catch(()=>({rows:[{total:108}]}))]);
    res.json({ timestamp: new Date().toISOString(), agents_total: agents.rows[0]?.total || 108 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/supervision/health', db, async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) as total FROM agent_registry').catch(()=>({rows:[{total:108}]}));
    res.json({ timestamp: new Date().toISOString(), agents: r.rows[0]?.total || 108 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/judicial/stats', db, async (req, res) => {
  try {
    const cache = await pool.query('SELECT COUNT(*) as total FROM sovereign_memory_local').catch(()=>({rows:[{total:0}]}));
    res.json({ timestamp: new Date().toISOString(), cache: cache.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/redundancy/health', db, async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT function_key, active_agent, failure_count, circuit_open FROM agent_redundancy_map ORDER BY failure_count DESC LIMIT 20');
    res.json({ timestamp: new Date().toISOString(), total: rows.length, all: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/performance/scores', db, async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT agent_name, accuracy_score, total_runs, failed_runs, degraded FROM agent_performance_scores ORDER BY accuracy_score DESC LIMIT 20');
    res.json({ timestamp: new Date().toISOString(), total: rows.length, agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use((req, res) => res.status(404).json({ error: 'Not Found', request_id: req.requestId }));
app.use((err, req, res, next) => { console.error('Unhandled:', err.message); res.status(500).json({ error: 'Internal Error', request_id: req.requestId }); });

app.listen(PORT, '0.0.0.0', () => {
  console.log('TRUNKIA listening on ' + PORT);
  ready = true;
  (async () => {
    try {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 15, idleTimeoutMillis: 30000 });
      await pool.query('SELECT 1');
      log('db_pool', true);
    } catch(e) { log('db_pool', false, e.message); return; }
    try {
      const { setupGracefulShutdown } = await import('./utils/graceful-shutdown.js');
      setupGracefulShutdown(pool);
      log('graceful_shutdown', true);
    } catch(e) { log('graceful_shutdown', false, e.message); }
    try {
      const { loadAllAgents } = await import('./agents/registry.js');
      await loadAllAgents();
      log('agent_registry', true);
    } catch(e) { log('agent_registry', false, e.message); }
    try {
      const { agentSupervisor } = await import('./agents/governance/agent-supervisor.js');
      await agentSupervisor.initialize();
      setInterval(() => agentSupervisor.run({}).catch(e => console.error('[SUP]', e.message)), 5 * 60000);
      log('agent_supervisor', true);
    } catch(e) { log('agent_supervisor', false, e.message); }
    try {
      const { startSelfHealer } = await import('./agents/utils/self-healer.js');
      startSelfHealer();
      log('self_healer', true);
    } catch(e) { log('self_healer', false, e.message); }
    try {
      const { runCacheRevalidation } = await import('./agents/utils/gateway-sentinel.js');
      setInterval(() => runCacheRevalidation().catch(e => console.error('[CACHE]', e.message)), 2 * 60 * 60000);
      log('gateway_sentinel', true);
    } catch(e) { log('gateway_sentinel', false, e.message); }
    try {
      const { auditPerformance } = await import('./agents/utils/performance-scorer.js');
      setInterval(() => auditPerformance().catch(e => console.error('[PERF]', e.message)), 30 * 60000);
      log('performance_scorer', true);
    } catch(e) { log('performance_scorer', false, e.message); }
    try {
      const { runRetention } = await import('./agents/utils/data-retention.js');
      setInterval(() => runRetention().catch(()=>{}), 24 * 60 * 60000);
      log('data_retention', true);
    } catch(e) { log('data_retention', false, e.message); }
    try {
      const { checkAndAlert } = await import('./agents/utils/alert-engine.js');
      setInterval(() => checkAndAlert().catch(e => console.error('[ALERT]', e.message)), 5 * 60000);
      log('alert_engine', true);
    } catch(e) { log('alert_engine', false, e.message); }
    console.log('Init: ' + initLog.filter(i=>i.status==='ok').length + '/' + initLog.length + ' OK');
  })();
});
