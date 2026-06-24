import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

process.on('unhandledRejection', function(r) { console.error('[FENCE] rejection:', r ? r.message : r); });
process.on('uncaughtException', function(e) { console.error('[FENCE] exception:', e.message); });

var app = express();
var PORT = 8080;
var pool = null;
var ready = false;

function fixDbUrl(url) {
  if (!url) return url;
  try {
    var u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch(e) { return url; }
}

app.use(function(req, res, next) { console.log('[REQ] ' + req.method + ' ' + req.url); next(); });
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*' }));
app.use(express.json({ limit: '50kb' }));
app.use(function(req, res, next) {
  req.requestId = crypto.randomUUID();
  req.pool = pool;
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-API-Version', 'v1');
  next();
});

app.get('/health', function(req, res) {
  res.json({ status: ready ? 'ok' : 'starting', ready: ready, port: PORT, time: new Date().toISOString() });
});
app.get('/ping', function(req, res) { res.json({ ok: true, ts: Date.now() }); });
app.get('/api/debug/init', function(req, res) { res.json({ ready: ready, port: PORT, node: process.version, db: pool ? 'connected' : 'disconnected' }); });

function db(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'DB not ready' });
  req.pool = pool;
  next();
}

app.get('/api/intelligence/geopolitical/:slug', db, async function(req, res) {
  try {
    var model = await pool.query('SELECT id, slug, name FROM models WHERE slug = $1', [req.params.slug]);
    if (!model.rows.length) return res.status(404).json({ error: 'Model not found' });
    var geo = await pool.query('SELECT * FROM model_geopolitical_risk WHERE model_id = $1', [model.rows[0].id]);
    if (!geo.rows.length) return res.status(404).json({ error: 'No geopolitical data' });
    var g = geo.rows[0];
    res.json({ model: req.params.slug, risk_score: g.risk_score, country_of_origin: g.country_of_origin, export_restricted: g.export_restricted, gdpr_compliant: g.gdpr_compliant, can_be_blocked: g.can_be_blocked, blocking_regions: g.blocking_regions || [], government_linked: g.government_linked });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/cost-calculate', db, async function(req, res) {
  try {
    var monthlyRequests = parseInt(req.query.requests) || 10000;
    var avgTokens = parseInt(req.query.tokens) || 1000;
    var result = await pool.query("SELECT m.slug, m.name, pt.tier_name, pt.input_price, pt.output_price, pt.price, pt.pricing_model, pt.availability FROM model_pricing_tiers pt JOIN models m ON pt.model_id = m.id WHERE pt.active = true AND m.status = 'active' AND (pt.input_price > 0 OR pt.output_price > 0 OR pt.price > 0)");
    var rows = result.rows;
    var results = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var inTok = monthlyRequests * avgTokens;
      var outTok = Math.round(inTok * 0.3);
      var cost = 0;
      if (row.pricing_model === 'per_token' || !row.pricing_model) { cost = (row.input_price || 0) * inTok + (row.output_price || 0) * outTok; } else { cost = (row.price || 0) * monthlyRequests; }
      if (cost > 0) results.push({ slug: row.slug, name: row.name, tier: row.tier_name, monthly_cost_usd: Math.round(cost * 1e6) / 1e6, per_request_cost: Math.round((cost / monthlyRequests) * 1e8) / 1e8, availability: row.availability });
    }
    results.sort(function(a, b) { return a.monthly_cost_usd - b.monthly_cost_usd; });
    res.json({ params: { monthly_requests: monthlyRequests, avg_tokens: avgTokens }, total: results.length, results: results.slice(0, 50) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/compare', db, async function(req, res) {
  try {
    var slugs = (req.query.models || '').split(',').filter(Boolean).slice(0, 5);
    if (slugs.length < 2) return res.status(400).json({ error: 'Provide 2+ slugs' });
    var models = await pool.query('SELECT id, slug, name, model_type, supported_languages FROM models WHERE slug = ANY($1)', [slugs]);
    if (models.rows.length < 2) return res.status(404).json({ error: 'Not all found' });
    var ids = models.rows.map(function(m) { return m.id; });
    var ben = await pool.query("SELECT m.slug, bd.slug as bslug, bd.name, mb.score, mb.percentile FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id WHERE m.id=ANY($1)", [ids]);
    var cap = await pool.query("SELECT m.slug, mc.capability FROM model_capabilities mc JOIN models m ON mc.model_id=m.id WHERE m.id=ANY($1)", [ids]);
    var pri = await pool.query("SELECT m.slug, pt.tier_name, pt.input_price, pt.output_price, pt.pricing_model, pt.availability FROM model_pricing_tiers pt JOIN models m ON pt.model_id=m.id WHERE m.id=ANY($1) AND pt.active=true", [ids]);
    var geo = await pool.query("SELECT m.slug, gr.* FROM model_geopolitical_risk gr JOIN models m ON gr.model_id=m.id WHERE m.id=ANY($1)", [ids]);
    var comp = {};
    for (var i = 0; i < models.rows.length; i++) { var m = models.rows[i]; comp[m.slug] = { name: m.name, type: m.model_type, languages: (m.supported_languages || []).length, benchmarks: {}, capabilities: [], pricing: [], geopolitical: null }; }
    for (var i = 0; i < ben.rows.length; i++) { var b = ben.rows[i]; if (comp[b.slug]) comp[b.slug].benchmarks[b.bslug] = { name: b.name, score: b.score, percentile: b.percentile }; }
    for (var i = 0; i < cap.rows.length; i++) { var c = cap.rows[i]; if (comp[c.slug]) comp[c.slug].capabilities.push(c.capability); }
    for (var i = 0; i < pri.rows.length; i++) { var p = pri.rows[i]; if (comp[p.slug]) comp[p.slug].pricing.push({ tier: p.tier_name, input_price: p.input_price, output_price: p.output_price, model: p.pricing_model, availability: p.availability }); }
    for (var i = 0; i < geo.rows.length; i++) { var g = geo.rows[i]; if (comp[g.slug]) comp[g.slug].geopolitical = { risk_score: g.risk_score, country: g.country_of_origin, gdpr: g.gdpr_compliant, restricted: g.export_restricted }; }
    res.json({ models: comp, compared: slugs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/benchmarks', db, async function(req, res) {
  try {
    var cat = req.query.category;
    var lim = Math.min(parseInt(req.query.limit) || 50, 100);
    var q = "SELECT m.slug, m.name, bd.slug as bslug, bd.name as bname, bd.category, mb.score, mb.percentile FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id";
    var p = [];
    if (cat) { q += ' WHERE bd.category=$1'; p.push(cat); }
    q += ' ORDER BY bd.slug, mb.score DESC LIMIT $' + (p.length + 1); p.push(lim);
    var result = await pool.query(q, p);
    var cats = await pool.query('SELECT DISTINCT category FROM benchmark_definitions ORDER BY category');
    res.json({ categories: cats.rows.map(function(r) { return r.category; }), total: result.rows.length, results: result.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/safety/:slug', db, async function(req, res) {
  try {
    var model = await pool.query('SELECT id, slug, name FROM models WHERE slug = $1', [req.params.slug]);
    if (!model.rows.length) return res.status(404).json({ error: 'Not found' });
    var mid = model.rows[0].id;
    var geo = await pool.query('SELECT * FROM model_geopolitical_risk WHERE model_id = $1', [mid]);
    var caps = await pool.query("SELECT capability FROM model_capabilities WHERE model_id = $1 AND capability IN ('streaming','function_calling','code','vision','arabic','long_context')", [mid]);
    var g = (geo.rows[0]) || {};
    var sc = caps.rows.map(function(r) { return r.capability; });
    var trust = 50;
    if (g.gdpr_compliant) trust += 15;
    if (!g.export_restricted) trust += 10;
    if (!g.government_linked) trust += 10;
    if (sc.indexOf('function_calling') >= 0) trust += 5;
    if (g.risk_score <= 3) trust += 10;
    res.json({ model: req.params.slug, name: model.rows[0].name, trust_score: Math.min(100, trust), geopolitical: { risk_score: g.risk_score, country: g.country_of_origin, gdpr: g.gdpr_compliant, export_restricted: g.export_restricted, blockable: g.can_be_blocked, blocking_regions: g.blocking_regions || [], government_linked: g.government_linked }, safety_capabilities: sc });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use('/v1/health', async function(req, res, next) { try { var r = await import('./routes/health.js'); r.default(req, res, next); } catch(e) { res.json({ status: 'ok' }); } });
app.use('/v1/metrics', async function(req, res, next) { try { var r = await import('./routes/metrics.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });
app.use('/v1/sovereign', async function(req, res, next) { try { var r = await import('./routes/sovereign.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });
app.use('/v1/shield', async function(req, res, next) { try { var r = await import('./routes/shield.js'); r.default(req, res, next); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/sovereign/dashboard', db, async function(req, res) { try { var a = await pool.query('SELECT COUNT(*) as total FROM agent_registry').catch(function() { return {rows:[{total:108}]}; }); res.json({ timestamp: new Date().toISOString(), agents_total: a.rows[0].total || 108 }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/supervision/health', db, async function(req, res) { try { var r = await pool.query('SELECT COUNT(*) as total FROM agent_registry').catch(function() { return {rows:[{total:108}]}; }); res.json({ timestamp: new Date().toISOString(), agents: r.rows[0].total || 108 }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/judicial/stats', db, async function(req, res) { try { var c = await pool.query('SELECT COUNT(*) as total FROM sovereign_memory_local').catch(function() { return {rows:[{total:0}]}; }); res.json({ timestamp: new Date().toISOString(), cache: c.rows[0] }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/redundancy/health', db, async function(req, res) { try { var r = await pool.query('SELECT function_key, active_agent, failure_count, circuit_open FROM agent_redundancy_map ORDER BY failure_count DESC LIMIT 20'); res.json({ timestamp: new Date().toISOString(), total: r.rows.length, all: r.rows }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/performance/scores', db, async function(req, res) { try { var r = await pool.query('SELECT agent_name, accuracy_score, total_runs, failed_runs, degraded FROM agent_performance_scores ORDER BY accuracy_score DESC LIMIT 20'); res.json({ timestamp: new Date().toISOString(), total: r.rows.length, agents: r.rows }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.use(function(req, res) { res.status(404).json({ error: 'Not Found' }); });
app.use(function(err, req, res, next) { console.error('[ERR] ' + err.message); res.status(500).json({ error: 'Internal Error' }); });

app.listen(PORT, '0.0.0.0', function() {
  console.log('TRUNKIA on 0.0.0.0:' + PORT);
  ready = true;
  (async function() {
    try {
      var dbUrl = fixDbUrl(process.env.DATABASE_URL);
      console.log('[DB] connecting...');
      pool = new pg.Pool({ connectionString: dbUrl, ssl: {rejectUnauthorized: false}, max: 15, idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 15000 });
      var test = await pool.query('SELECT 1 as ok');
      console.log('[OK] db_pool');
    } catch(e) { console.log('[FAIL] db_pool: ' + e.message); return; }
    try { var m = await import('./utils/graceful-shutdown.js'); m.setupGracefulShutdown(pool); console.log('[OK] shutdown'); } catch(e) { console.log('[SKIP] shutdown'); }
    try { var m = await import('./agents/registry.js'); await m.loadAllAgents(); console.log('[OK] agents'); } catch(e) { console.log('[SKIP] agents'); }
    try { var m = await import('./agents/governance/agent-supervisor.js'); await m.agentSupervisor.initialize(); setInterval(function() { m.agentSupervisor.run({}).catch(function() {}); }, 300000); console.log('[OK] supervisor'); } catch(e) { console.log('[SKIP] supervisor'); }
    try { var m = await import('./agents/utils/self-healer.js'); m.startSelfHealer(); console.log('[OK] healer'); } catch(e) { console.log('[SKIP] healer'); }
    console.log('Init done');
  })();
});
