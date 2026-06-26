import { sanitizeInput, estimateTokens, classifyTask, selectModel, callGroq, estimateCost } from './lib/inference.js';
import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
dotenv.config();

var app = express();
var PORT = process.env.PORT || 8080;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var START_TIME = Date.now();
var LAST_SYNC = null;
var cronJobs = {};
var cronStats = {};
var requestCounter = 0;

/* ===== SECURITY: Helmet ===== */
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

/* ===== SECURITY: CORS ===== */
app.use(cors({
  origin: function(origin, callback) {
    var allowed = (process.env.CORS_ORIGINS || '*').split(',').map(function(s) { return s.trim(); });
    if (allowed.indexOf('*') !== -1 || !origin || allowed.indexOf(origin) !== -1) { callback(null, true); }
    else { callback(new Error('CORS blocked')); }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 86400
}));

/* ===== SECURITY: Rate Limiting ===== */
var globalLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Rate limit exceeded', retry_after: 60 } });
app.use('/api/', globalLimiter);

var strictLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Strict rate limit exceeded', retry_after: 60 } });
app.use('/api/self-heal/', strictLimiter);
app.use('/api/scheduler/trigger/', strictLimiter);

/* ===== SECURITY: Body Size ===== */
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/* ===== CIRCUIT BREAKER ===== */
var circuit = { state: 'CLOSED', failures: 0, lastFailure: 0, successThreshold: 3, failureThreshold: 5, resetTimeoutMs: 30000, halfOpenSuccesses: 0 };
function circuitIsOpen() {
  if (circuit.state === 'OPEN') { if (Date.now() - circuit.lastFailure > circuit.resetTimeoutMs) { circuit.state = 'HALF_OPEN'; circuit.halfOpenSuccesses = 0; return false; } return true; }
  return false;
}
function circuitRecordSuccess() {
  if (circuit.state === 'HALF_OPEN') { circuit.halfOpenSuccesses++; if (circuit.halfOpenSuccesses >= circuit.successThreshold) { circuit.state = 'CLOSED'; circuit.failures = 0; } } else { circuit.failures = 0; }
}
function circuitRecordFailure() {
  circuit.failures++; circuit.lastFailure = Date.now();
  if (circuit.state === 'HALF_OPEN') { circuit.state = 'OPEN'; } else if (circuit.failures >= circuit.failureThreshold) { circuit.state = 'OPEN'; }
}

/* ===== DB POOL ===== */
function fixDbUrl(url) {
  if (!url) return null;
  var parts = url.split('?');
  if (parts.length < 2) return url;
  var params = parts[1].split('&');
  var filtered = [];
  for (var i = 0; i < params.length; i++) { if (params[i].indexOf('channel_binding=') !== 0) filtered.push(params[i]); }
  return parts[0] + '?' + filtered.join('&');
}
var pool = null;
function getPool() {
  if (!pool) {
    var dbUrl = fixDbUrl(process.env.DATABASE_URL);
    if (!dbUrl) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    pool.on('error', function(err) { console.error('[POOL ERROR]', err.message); circuitRecordFailure(); });
  }
  return pool;
}
async function safeQuery(sql, params) {
  if (circuitIsOpen()) throw new Error('CIRCUIT_OPEN: Too many DB failures');
  try { var r = await getPool().query(sql, params); circuitRecordSuccess(); return r; }
  catch (e) { circuitRecordFailure(); throw e; }
}

/* ===== CACHED HEALTH ===== */
var cachedHealth = null;
var cacheTime = 0;
function updateCachedHealth(d) { cachedHealth = d; cacheTime = Date.now(); }

/* ===== AGENT SCANNER ===== */
function classifyLayer(name, fp) {
  var ln = name.toLowerCase();
  var dh = '';
  if (fp && fp.indexOf('/') !== -1) { var p = fp.split('/'); dh = p[p.length - 2].toLowerCase(); }
  if (dh === 'security' || ln.indexOf('security') !== -1 || ln.indexOf('shield') !== -1) return 'security';
  if (dh === 'brain' || dh === 'memory' || dh === 'cognitive' || ln.indexOf('brain') !== -1 || ln.indexOf('memory') !== -1) return 'cognitive';
  if (dh === 'governance' || ln.indexOf('govern') !== -1 || ln.indexOf('sovereign') !== -1) return 'governance';
  if (dh === 'observability' || ln.indexOf('log') !== -1 || ln.indexOf('diag') !== -1 || ln.indexOf('monitor') !== -1) return 'observability';
  if (dh === 'orchestration' || ln.indexOf('registry') !== -1 || ln.indexOf('task') !== -1 || ln.indexOf('queue') !== -1) return 'orchestration';
  if (dh === 'validation' || ln.indexOf('verif') !== -1 || ln.indexOf('valid') !== -1) return 'validation';
  if (dh === 'repair' || ln.indexOf('fix') !== -1 || ln.indexOf('heal') !== -1) return 'repair';
  if (dh === 'learning' || ln.indexOf('learn') !== -1) return 'learning';
  if (dh === 'analysis' || ln.indexOf('analy') !== -1) return 'analysis';
  if (dh === 'content' || ln.indexOf('content') !== -1) return 'content';
  if (dh === 'intelligence' || ln.indexOf('intel') !== -1) return 'intelligence';
  if (dh === 'service' || ln.indexOf('servic') !== -1) return 'service';
  return dh || 'autonomous';
}
function scanAgentFiles(baseDir, relPath) {
  var dir = baseDir || path.join(__dirname, 'agents');
  var rel = relPath || '';
  if (!fs.existsSync(dir)) return [];
  var results = [];
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    var full = path.join(dir, e.name);
    var fileRel = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { var sub = scanAgentFiles(full, fileRel); for (var j = 0; j < sub.length; j++) results.push(sub[j]); }
    else if (e.isFile() && e.name.endsWith('.js')) { var nm = e.name.replace('.js', ''); var st; try { st = fs.statSync(full); } catch (ex) { st = { size: 0 }; } results.push({ agent_name: nm, agent_layer: classifyLayer(nm, fileRel), filename: fileRel, file_size: st.size }); }
  }
  return results;
}
async function syncAgentsToDb() {
  var agents = scanAgentFiles();
  var p = getPool();
  var synced = 0, updated = 0, errors = 0;
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    var cfg = { filename: a.filename, file_size: a.file_size, synced_at: new Date().toISOString() };
    try {
      var ex = await p.query("SELECT agent_name FROM agent_registry WHERE agent_name=$1", [a.agent_name]);
      if (ex.rows.length > 0) { await p.query("UPDATE agent_registry SET agent_layer=$1,config=$2 WHERE agent_name=$3", [a.agent_layer, cfg, a.agent_name]); updated++; }
      else { await p.query("INSERT INTO agent_registry (agent_name,agent_layer,status,config) VALUES ($1,$2,$3,$4)", [a.agent_name, a.agent_layer, 'DEPLOYED', cfg]); synced++; }
    } catch (ex) { errors++; }
  }
  LAST_SYNC = new Date().toISOString();
  return { total_files: agents.length, inserted: synced, updated: updated, errors: errors };
}

/* ===== SELF-HEAL ===== */
async function selfHeal() {
  var heals = [];
  try {
    var p = getPool();
    var r1 = await p.query("SELECT agent_name FROM agent_registry WHERE fail_count>10 AND status!='FAULT_ISOLATED'");
    for (var i = 0; i < r1.rows.length; i++) { await p.query("UPDATE agent_registry SET status='FAULT_ISOLATED',fail_count=0 WHERE agent_name=$1", [r1.rows[i].agent_name]); heals.push({ action: 'isolate', agent: r1.rows[i].agent_name }); }
    var r2 = await p.query("SELECT agent_name FROM agent_registry WHERE status='FAULT_ISOLATED' AND fail_count=0");
    for (var j = 0; j < r2.rows.length; j++) { await p.query("UPDATE agent_registry SET status='DEPLOYED' WHERE agent_name=$1", [r2.rows[j].agent_name]); heals.push({ action: 'restore', agent: r2.rows[j].agent_name }); }
    if (circuit.state === 'OPEN' && Date.now() - circuit.lastFailure > 60000) { circuit.state = 'HALF_OPEN'; circuit.halfOpenSuccesses = 0; heals.push({ action: 'circuit_half_open' }); }
  } catch (e) { heals.push({ action: 'error', message: e.message }); }
  return { healed: heals.length, actions: heals, timestamp: new Date().toISOString() };
}

/* ===== HELPERS ===== */
function fmt(s) { var h = Math.floor(s / 3600); var m = Math.floor((s % 3600) / 60); return h + 'h ' + m + 'm ' + (s % 60) + 's'; }
function grade(sc) { if (sc >= 90) return 'A'; if (sc >= 80) return 'B'; if (sc >= 70) return 'C'; if (sc >= 60) return 'D'; return 'F'; }

/* ===== MIDDLEWARE: Request Tracking ===== */
app.use(function(req, res, next) {
  var start = Date.now();
  var rid = Math.random().toString(36).substring(2, 10);
  req._startTime = start; req._requestId = rid;
  requestCounter++;
  res.setHeader('x-request-id', rid);
  res.setHeader('x-powered-by', 'TRUNKIA');
  res.setHeader('x-circuit-state', circuit.state);
  res.removeHeader('X-Powered-By');
  var origEnd = res.end;
  res.end = function(chunk, enc) { res.setHeader('x-response-time', (Date.now() - start) + 'ms'); origEnd.call(res, chunk, enc); };
  next();
});
app.use(function(err, req, res, next) {
  if (err.message === 'CORS blocked') return res.status(403).json({ error: 'Forbidden', request_id: req._requestId });
  console.error('[UNCAUGHT]', err.message);
  res.status(500).json({ error: 'Internal error', request_id: req._requestId || 'unknown' });
});

/* ===== SYSTEM ===== */
app.get('/health', function(req, res) { res.json({ status: circuit.state === 'OPEN' ? 'degraded' : 'ok', port: PORT, phase: 7, uptime: fmt(Math.floor((Date.now() - START_TIME) / 1000)), circuit: circuit.state, endpoints: 21, requests_served: requestCounter, time: new Date().toISOString() }); });
app.get('/ping', function(req, res) { res.json({ pong: true, ts: Date.now() }); });

/* ===== INTELLIGENCE ===== */
app.get('/api/intelligence/geopolitical/:slug', async function(req, res) { try { var r = await safeQuery("SELECT m.slug,m.name,g.country_of_origin,g.risk_score,g.data_law_risk,g.sanctions_risk,g.blocking_risk,g.censorship_risk,g.notes,g.assessed_at FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1", [req.params.slug]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'Not found' }); updateCachedHealth({ type: 'geo', slug: req.params.slug, data: r.rows[0] }); res.json({ model: r.rows[0] }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/cost-calculate', async function(req, res) { try { var slug = req.query.slug; var tokens = parseInt(req.query.tokens, 10); if (!slug) return res.status(400).json({ error: 'slug required' }); if (!tokens || tokens <= 0) return res.status(400).json({ error: 'tokens must be positive' }); var r = await safeQuery("SELECT m.slug,m.name,p.tier_name,p.pricing_model,p.currency,p.price,p.min_usage,p.max_usage FROM model_pricing_tiers p JOIN models m ON p.model_id=m.id WHERE m.slug=$1 AND p.active=true AND p.deleted_at IS NULL ORDER BY p.min_usage ASC", [slug]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No pricing' }); var sel = null; for (var i = 0; i < r.rows.length; i++) { var mn = parseInt(r.rows[i].min_usage, 10) || 0; var mx = parseInt(r.rows[i].max_usage, 10) || 999999999; if (tokens >= mn && tokens <= mx) { sel = r.rows[i]; break; } } if (!sel) sel = r.rows[r.rows.length - 1]; var up = parseFloat(sel.price) || 0; res.json({ model: { slug: slug, name: r.rows[0].name }, tokens_requested: tokens, matched_tier: sel.tier_name, unit_price: up, total_cost: up * tokens, currency: sel.currency }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/benchmarks', async function(req, res) { try { var slug = req.query.slug; if (!slug) return res.status(400).json({ error: 'slug required' }); var r = await safeQuery("SELECT m.slug,m.name,b.benchmark_definition_id,b.score,b.percentile,b.sample_count,b.measured_at FROM model_benchmarks b JOIN models m ON b.model_id=m.id WHERE m.slug=$1 ORDER BY b.measured_at DESC", [slug]); res.json({ model: slug, benchmark_count: (r && r.rows) ? r.rows.length : 0, benchmarks: (r && r.rows) ? r.rows : [] }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/compare', async function(req, res) { try { var slugs = (req.query.slugs || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; }); if (slugs.length < 2) return res.status(400).json({ error: 'Min 2 slugs' }); if (slugs.length > 5) return res.status(400).json({ error: 'Max 5 slugs' }); var mr = await safeQuery("SELECT id,slug,name,model_type,parameter_count,context_window,is_open_source,status FROM models WHERE slug=ANY($1)", [slugs]); var results = []; for (var i = 0; i < mr.rows.length; i++) { var m = mr.rows[i]; var br = await safeQuery("SELECT benchmark_definition_id,score,percentile FROM model_benchmarks WHERE model_id=$1", [m.id]); results.push({ slug: m.slug, name: m.name, model_type: m.model_type, context_window: m.context_window, is_open_source: m.is_open_source, status: m.status, benchmark_count: (br && br.rows) ? br.rows.length : 0, benchmarks: (br && br.rows) ? br.rows : [] }); } res.json({ compared: results.length, models: results }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/safety/:slug', async function(req, res) { try { var r = await safeQuery("SELECT m.slug,m.name,c.capability,c.description,c.details FROM model_capabilities c JOIN models m ON c.model_id=m.id WHERE m.slug=$1", [req.params.slug]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No capabilities' }); res.json({ model: { slug: req.params.slug, name: r.rows[0].name }, capability_count: r.rows.length, capabilities: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== AGENTS ===== */
app.get('/api/agents', async function(req, res) { try { var layer = req.query.layer; var status = req.query.status; var q = "SELECT agent_name,agent_layer,status,model_provider,last_run,run_count,success_count,fail_count,avg_duration_ms,config,created_at FROM agent_registry"; var params = []; var conds = []; if (layer) { conds.push("agent_layer=$" + (params.length + 1)); params.push(layer); } if (status) { conds.push("status=$" + (params.length + 1)); params.push(status); } if (conds.length > 0) q += " WHERE " + conds.join(" AND "); q += " ORDER BY agent_name ASC"; var r = await safeQuery(q, params.length > 0 ? params : undefined); res.json({ count: r.rows.length, agents: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/sync', async function(req, res) { try { var result = await syncAgentsToDb(); res.json({ sync_completed: true, last_sync: LAST_SYNC, result: result }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/layers', async function(req, res) { try { var r = await safeQuery("SELECT agent_layer,count(*) as cnt,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry GROUP BY agent_layer ORDER BY cnt DESC"); res.json({ layers: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/stats', async function(req, res) { try { var r = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted,coalesce(sum(run_count),0) as total_runs FROM agent_registry"); var files = scanAgentFiles(); res.json({ database: r.rows[0], filesystem: { total_files: files.length }, last_sync: LAST_SYNC }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== SUPERVISOR ===== */
app.get('/api/supervisor/diagnostic', async function(req, res) { try { var dbS = Date.now(); await safeQuery('SELECT 1'); var dbL = Date.now() - dbS; var mem = process.memoryUsage(); var usedMb = Math.round(mem.rss / 1024 / 1024); var files = scanAgentFiles(); var dbA = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry"); var d = dbA.rows[0]; var sc = 100; if (dbL > 500) sc -= 25; if (parseInt(d.total, 10) < files.length) sc -= 25; if (usedMb > 460) sc -= 25; if (parseInt(d.faulted, 10) > 0) sc -= 15; if (circuit.state !== 'CLOSED') sc -= 10; sc = Math.max(0, sc); res.json({ health_score: sc, health_grade: grade(sc), circuit: { state: circuit.state, failures: circuit.failures }, checks: { database: { status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', latency_ms: dbL, passed: dbL < 500 }, agents: { filesystem: files.length, database: parseInt(d.total, 10), synced: parseInt(d.total, 10) >= files.length, passed: parseInt(d.total, 10) >= files.length }, memory: { used_mb: usedMb, percent: Math.round((usedMb / 512) * 100), passed: usedMb < 460 }, faults: { count: parseInt(d.faulted, 10), passed: parseInt(d.faulted, 10) === 0 }, circuit: { state: circuit.state, passed: circuit.state === 'CLOSED' } }, security: { helmet: true, rate_limit: '120/min global, 20/min strict', cors: 'enabled', body_limit: '100kb' }, timestamp: new Date().toISOString() }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/supervisor/status', async function(req, res) { try { var dbS = Date.now(); await safeQuery('SELECT 1'); res.json({ db_latency_ms: Date.now() - dbS, db_status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', circuit: circuit, cron_jobs_active: Object.keys(cronJobs).length, cron_stats: cronStats, last_sync: LAST_SYNC, requests_served: requestCounter, uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000) }); } catch (e) { res.json({ db_status: 'error', circuit: circuit, error: e.message }); } });

/* ===== SCHEDULER ===== */
app.get('/api/scheduler/status', function(req, res) { var jobs = []; var k = Object.keys(cronJobs); for (var i = 0; i < k.length; i++) jobs.push({ name: k[i], running: true, last_execution: cronStats[k[i]] || null }); res.json({ active_jobs: jobs.length, jobs: jobs }); });
app.get('/api/scheduler/trigger/:name', async function(req, res) { try { var n = req.params.name; if (n === 'agent-sync') { var r = await syncAgentsToDb(); res.json({ triggered: n, result: r }); } else if (n === 'agent-heartbeat') { var r2 = await safeQuery("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'"); res.json({ triggered: n, updated: r2.rowCount }); } else if (n === 'self-heal') { var h = await selfHeal(); res.json({ triggered: n, result: h }); } else { res.status(404).json({ error: 'Unknown job', available: ['agent-sync', 'agent-heartbeat', 'self-heal'] }); } } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== SYSTEM PULSE ===== */
app.get('/api/system/pulse', async function(req, res) { try { var upSec = Math.floor((Date.now() - START_TIME) / 1000); var dbS = Date.now(); await safeQuery('SELECT 1'); var dbL = Date.now() - dbS; var mem = process.memoryUsage(); var usedMb = Math.round(mem.rss / 1024 / 1024); var files = scanAgentFiles(); var dbA = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry"); var d = dbA.rows[0]; var sc = 100; if (dbL > 500) sc -= 25; if (parseInt(d.total, 10) < files.length) sc -= 25; if (usedMb > 460) sc -= 25; if (parseInt(d.faulted, 10) > 0) sc -= 15; if (circuit.state !== 'CLOSED') sc -= 10; sc = Math.max(0, sc); updateCachedHealth({ score: sc, grade: grade(sc) }); res.json({ system: 'TRUNKIA', version: '1.0.0', phase: 7, uptime: fmt(upSec), uptime_seconds: upSec, health_score: sc, health_grade: grade(sc), components: { database: { status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', latency_ms: dbL }, agents: { total: files.length, deployed: parseInt(d.deployed, 10), faulted: parseInt(d.faulted, 10) }, scheduler: { active_jobs: Object.keys(cronJobs).length, stats: cronStats }, memory: { used_mb: usedMb, limit_mb: 512, percent: Math.round((usedMb / 512) * 100) }, circuit_breaker: { state: circuit.state, failures: circuit.failures }, security: { helmet: true, rate_limit_active: true, cors_enabled: true } }, endpoints: 21, requests_served: requestCounter, last_sync: LAST_SYNC, timestamp: new Date().toISOString() }); } catch (e) { var fb = cachedHealth || { score: 0, grade: 'F' }; res.status(503).json({ degraded: true, cached_health: fb, error: e.message, circuit: circuit.state, timestamp: new Date().toISOString() }); } });
app.get('/api/system/metrics', function(req, res) { var mem = process.memoryUsage(); res.json({ process: { pid: process.pid, node_version: process.version, platform: process.platform, uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000), requests_served: requestCounter }, memory: { rss_mb: Math.round(mem.rss / 1024 / 1024), heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024), heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024) }, security: { helmet: true, rate_limit: '120/min', cors: true, body_limit: '100kb' } }); });

/* ===== SELF-HEAL + CIRCUIT ===== */
app.get('/api/self-heal/run', async function(req, res) { try { var r = await selfHeal(); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/self-heal/status', function(req, res) { res.json({ circuit_breaker: { state: circuit.state, failures: circuit.failures, last_failure: circuit.lastFailure ? new Date(circuit.lastFailure).toISOString() : null, failure_threshold: circuit.failureThreshold, reset_timeout_ms: circuit.resetTimeoutMs, success_threshold: circuit.successThreshold }, cached_health: cachedHealth, cache_age_seconds: cacheTime ? Math.floor((Date.now() - cacheTime) / 1000) : null }); });
app.get('/api/self-heal/circuit/reset', function(req, res) { circuit.state = 'CLOSED'; circuit.failures = 0; circuit.halfOpenSuccesses = 0; res.json({ circuit: 'reset', new_state: 'CLOSED' }); });

/* ===== 404 HANDLER ===== */
app.use(function(req, res) {
  res.status(404).json({ error: 'Not found', request_id: req._requestId || 'unknown' });
});

/* ===== CRON ===== */
function setupCron(cl) {
  if (!cl) return;
  try {
    cronJobs['agent-heartbeat'] = cl.schedule('*/5 * * * *', async function() { try { await safeQuery("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'"); cronStats['agent-heartbeat'] = { last: new Date().toISOString(), status: 'ok' }; } catch (e) { cronStats['agent-heartbeat'] = { last: new Date().toISOString(), status: 'error', error: e.message }; } });
    cronJobs['agent-sync'] = cl.schedule('0 * * * *', async function() { try { var r = await syncAgentsToDb(); cronStats['agent-sync'] = { last: new Date().toISOString(), status: 'ok' }; } catch (e) { cronStats['agent-sync'] = { last: new Date().toISOString(), status: 'error' }; } });
    cronJobs['self-heal'] = cl.schedule('*/15 * * * *', async function() { try { var r = await selfHeal(); cronStats['self-heal'] = { last: new Date().toISOString(), status: 'ok', healed: r.healed }; } catch (e) { cronStats['self-heal'] = { last: new Date().toISOString(), status: 'error' }; } });
    console.log('Cron: 3 jobs scheduled');
  } catch (e) { console.error('[CRON ERR]', e.message); }
}

/* ===== START ===== */

// ═══════════════════════════════════════════════════════════
// INFERENCE LAYER ENDPOINTS (TRUNKIA AI GATEWAY)
// ═══════════════════════════════════════════════════════════
app.get('/api/inference/models', (req, res) => {
  try {
    const models = [
      { id: 'llama-3.3-70b-versatile', provider: 'groq', available: !!process.env.GROQ_API_KEY, tier: 'advanced' },
      { id: 'llama-3.1-8b-instant', provider: 'groq', available: !!process.env.GROQ_API_KEY, tier: 'fast' }
    ];
    res.status(200).json({ success: true, models });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

app.post('/api/inference/cost-estimate', (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    const { sanitized } = sanitizeInput(message);
    const tokensIn = estimateTokens(sanitized);
    const estimatedTokensOut = 500;
    const cost = estimateCost(tokensIn, estimatedTokensOut, 'llama-3.3-70b-versatile');
    res.status(200).json({
      success: true,
      estimated_input_tokens: tokensIn,
      estimated_output_tokens: estimatedTokensOut,
      estimated_cost_usd: cost.total_cost.toFixed(6)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});

app.post('/api/inference/chat', async (req, res) => {
  try {
    const { message, model: userChoice } = req.body;
    if (!message || typeof message !== 'string' || message.length > 50000) {
      return res.status(400).json({ success: false, error: 'Invalid message' });
    }
    const startTime = Date.now();
    const { sanitized, flags } = sanitizeInput(message);
    const taskType = classifyTask(sanitized);
    const modelName = selectModel(taskType, userChoice);
    const result = await callGroq(sanitized, null, modelName);
    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error });
    }
    const cost = estimateCost(result.tokens_in, result.tokens_out, modelName);
    console.log('[INFERENCE]', JSON.stringify({ task_type: taskType, model: modelName, tokens_in: result.tokens_in, tokens_out: result.tokens_out, cost_usd: cost.total_cost.toFixed(6), latency_ms: Date.now() - startTime, pii_flags: flags }));
    res.status(200).json({
      success: true,
      content: result.content,
      model_used: result.model,
      task_type: taskType,
      tokens: { in: result.tokens_in, out: result.tokens_out },
      cost_usd: cost.total_cost.toFixed(6),
      latency_ms: Date.now() - startTime,
      pii_flags: flags
    });
  } catch (err) {
    console.error('[CHAT_ERROR]', err.message);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});


app.listen(PORT, async function() {
  console.log('TRUNKIA Phase7 on :' + PORT);
  try { var r = await syncAgentsToDb(); console.log('Sync: ' + r.inserted + ' new, ' + r.updated + ' updated, ' + r.total_files + ' total'); } catch (e) { console.error('[SYNC ERR]', e.message); }
  try { var cm = await import('node-cron'); setupCron(cm.default || cm); } catch (e) { console.log('[WARN] node-cron not available'); }
});
