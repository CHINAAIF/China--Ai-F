import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

var app = express();
var PORT = process.env.PORT || 8080;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var START_TIME = Date.now();
var LAST_SYNC = null;
var cronJobs = {};
var cronStats = {};

/* ===== DB POOL ===== */
function fixDbUrl(url) {
  if (!url) return null;
  var parts = url.split('?');
  if (parts.length < 2) return url;
  var params = parts[1].split('&');
  var filtered = [];
  for (var i = 0; i < params.length; i++) {
    if (params[i].indexOf('channel_binding=') !== 0) filtered.push(params[i]);
  }
  return parts[0] + '?' + filtered.join('&');
}

var pool = null;
function getPool() {
  if (!pool) {
    var dbUrl = fixDbUrl(process.env.DATABASE_URL);
    if (!dbUrl) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

/* ===== RECURSIVE AGENT SCANNER ===== */
function classifyLayer(name, filePath) {
  var ln = name.toLowerCase();
  var dirHint = '';
  if (filePath && filePath.indexOf('/') !== -1) {
    var parts = filePath.split('/');
    dirHint = parts[parts.length - 2].toLowerCase();
  }
  if (dirHint === 'security' || ln.indexOf('security') !== -1 || ln.indexOf('shield') !== -1 || ln.indexOf('firewall') !== -1) return 'security';
  if (dirHint === 'brain' || dirHint === 'memory' || dirHint === 'cognitive' || ln.indexOf('brain') !== -1 || ln.indexOf('memory') !== -1 || ln.indexOf('knowledge') !== -1) return 'cognitive';
  if (dirHint === 'governance' || ln.indexOf('govern') !== -1 || ln.indexOf('sovereign') !== -1 || ln.indexOf('policy') !== -1) return 'governance';
  if (dirHint === 'observability' || ln.indexOf('log') !== -1 || ln.indexOf('diag') !== -1 || ln.indexOf('inspect') !== -1 || ln.indexOf('monitor') !== -1) return 'observability';
  if (dirHint === 'orchestration' || ln.indexOf('registry') !== -1 || ln.indexOf('task') !== -1 || ln.indexOf('scheduler') !== -1 || ln.indexOf('queue') !== -1) return 'orchestration';
  if (dirHint === 'validation' || ln.indexOf('verif') !== -1 || ln.indexOf('valid') !== -1 || ln.indexOf('audit') !== -1) return 'validation';
  if (dirHint === 'repair' || ln.indexOf('fix') !== -1 || ln.indexOf('patch') !== -1 || ln.indexOf('repair') !== -1 || ln.indexOf('heal') !== -1) return 'repair';
  if (dirHint === 'learning' || ln.indexOf('learn') !== -1) return 'learning';
  if (dirHint === 'analysis' || ln.indexOf('analy') !== -1) return 'analysis';
  if (dirHint === 'content' || ln.indexOf('content') !== -1 || ln.indexOf('translat') !== -1) return 'content';
  if (dirHint === 'intelligence' || ln.indexOf('intel') !== -1) return 'intelligence';
  if (dirHint === 'service' || ln.indexOf('servic') !== -1) return 'service';
  return dirHint || 'autonomous';
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
    if (e.isDirectory()) {
      var sub = scanAgentFiles(full, fileRel);
      for (var j = 0; j < sub.length; j++) results.push(sub[j]);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      var name = e.name.replace('.js', '');
      var layer = classifyLayer(name, fileRel);
      var stat;
      try { stat = fs.statSync(full); } catch (ex) { stat = { size: 0 }; }
      results.push({ agent_name: name, agent_layer: layer, filename: fileRel, file_size: stat.size });
    }
  }
  return results;
}

async function syncAgentsToDb() {
  var agents = scanAgentFiles();
  var p = getPool();
  var synced = 0, updated = 0, errors = 0;
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    var config = { filename: a.filename, file_size: a.file_size, synced_at: new Date().toISOString() };
    try {
      var existing = await p.query("SELECT agent_name FROM agent_registry WHERE agent_name = $1", [a.agent_name]);
      if (existing.rows.length > 0) {
        await p.query("UPDATE agent_registry SET agent_layer = $1, config = $2 WHERE agent_name = $3", [a.agent_layer, config, a.agent_name]);
        updated++;
      } else {
        await p.query("INSERT INTO agent_registry (agent_name, agent_layer, status, config) VALUES ($1, $2, $3, $4)", [a.agent_name, a.agent_layer, 'DEPLOYED', config]);
        synced++;
      }
    } catch (e) { errors++; }
  }
  LAST_SYNC = new Date().toISOString();
  return { total_files: agents.length, inserted: synced, updated: updated, errors: errors };
}

/* ===== MIDDLEWARE: Request Tracking ===== */
app.use(function(req, res, next) {
  var start = Date.now();
  var reqId = Math.random().toString(36).substring(2, 10);
  req._startTime = start;
  req._requestId = reqId;
  res.setHeader('x-request-id', reqId);
  res.setHeader('x-powered-by', 'TRUNKIA');
  var origEnd = res.end;
  res.end = function(chunk, enc) {
    res.setHeader('x-response-time', (Date.now() - start) + 'ms');
    origEnd.call(res, chunk, enc);
  };
  next();
});

/* ===== HELPERS ===== */
function formatUptime(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  return h + 'h ' + m + 'm ' + s + 's';
}

function healthGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/* ===== SYSTEM ROUTES ===== */
app.get('/health', function(req, res) {
  var up = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({ status: 'ok', port: PORT, phase: 5, uptime: formatUptime(up), endpoints: 17, time: new Date().toISOString() });
});

app.get('/ping', function(req, res) {
  res.json({ pong: true, ts: Date.now() });
});

/* ===== PHASE 3: INTELLIGENCE ===== */
app.get('/api/intelligence/geopolitical/:slug', async function(req, res) {
  try {
    var r = await getPool().query("SELECT m.slug,m.name,g.country_of_origin,g.risk_score,g.data_law_risk,g.sanctions_risk,g.blocking_risk,g.censorship_risk,g.notes,g.assessed_at FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1", [req.params.slug]);
    if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ model: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/cost-calculate', async function(req, res) {
  try {
    var slug = req.query.slug;
    var tokens = parseInt(req.query.tokens, 10);
    if (!slug) return res.status(400).json({ error: 'slug required' });
    if (!tokens || tokens <= 0) return res.status(400).json({ error: 'tokens must be positive' });
    var r = await getPool().query("SELECT m.slug,m.name,p.tier_name,p.pricing_model,p.currency,p.price,p.min_usage,p.max_usage FROM model_pricing_tiers p JOIN models m ON p.model_id=m.id WHERE m.slug=$1 AND p.active=true AND p.deleted_at IS NULL ORDER BY p.min_usage ASC", [slug]);
    if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No pricing found' });
    var sel = null;
    for (var i = 0; i < r.rows.length; i++) {
      var mn = parseInt(r.rows[i].min_usage, 10) || 0;
      var mx = parseInt(r.rows[i].max_usage, 10) || 999999999;
      if (tokens >= mn && tokens <= mx) { sel = r.rows[i]; break; }
    }
    if (!sel) sel = r.rows[r.rows.length - 1];
    var up = parseFloat(sel.price) || 0;
    res.json({ model: { slug: slug, name: r.rows[0].name }, tokens_requested: tokens, matched_tier: sel.tier_name, unit_price: up, total_cost: up * tokens, currency: sel.currency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/benchmarks', async function(req, res) {
  try {
    var slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    var r = await getPool().query("SELECT m.slug,m.name,b.benchmark_definition_id,b.score,b.percentile,b.sample_count,b.measured_at FROM model_benchmarks b JOIN models m ON b.model_id=m.id WHERE m.slug=$1 ORDER BY b.measured_at DESC", [slug]);
    res.json({ model: slug, benchmark_count: (r && r.rows) ? r.rows.length : 0, benchmarks: (r && r.rows) ? r.rows : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/compare', async function(req, res) {
  try {
    var slugs = (req.query.slugs || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    if (slugs.length < 2) return res.status(400).json({ error: 'Min 2 slugs' });
    if (slugs.length > 5) return res.status(400).json({ error: 'Max 5 slugs' });
    var mr = await getPool().query("SELECT id,slug,name,model_type,parameter_count,context_window,is_open_source,status FROM models WHERE slug=ANY($1)", [slugs]);
    var results = [];
    for (var i = 0; i < mr.rows.length; i++) {
      var m = mr.rows[i];
      var br = await getPool().query("SELECT benchmark_definition_id,score,percentile FROM model_benchmarks WHERE model_id=$1", [m.id]);
      results.push({ slug: m.slug, name: m.name, model_type: m.model_type, context_window: m.context_window, is_open_source: m.is_open_source, status: m.status, benchmark_count: (br && br.rows) ? br.rows.length : 0, benchmarks: (br && br.rows) ? br.rows : [] });
    }
    res.json({ compared: results.length, models: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/safety/:slug', async function(req, res) {
  try {
    var r = await getPool().query("SELECT m.slug,m.name,c.capability,c.description,c.details FROM model_capabilities c JOIN models m ON c.model_id=m.id WHERE m.slug=$1", [req.params.slug]);
    if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No capabilities found' });
    res.json({ model: { slug: req.params.slug, name: r.rows[0].name }, capability_count: r.rows.length, capabilities: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== PHASE 4: AGENT REGISTRY ===== */
app.get('/api/agents', async function(req, res) {
  try {
    var layer = req.query.layer;
    var status = req.query.status;
    var q = "SELECT agent_name,agent_layer,status,model_provider,last_run,run_count,success_count,fail_count,avg_duration_ms,config,created_at FROM agent_registry";
    var params = [];
    var conds = [];
    if (layer) { conds.push("agent_layer=$" + (params.length + 1)); params.push(layer); }
    if (status) { conds.push("status=$" + (params.length + 1)); params.push(status); }
    if (conds.length > 0) q += " WHERE " + conds.join(" AND ");
    q += " ORDER BY agent_name ASC";
    var r = await getPool().query(q, params.length > 0 ? params : undefined);
    res.json({ count: r.rows.length, agents: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/sync', async function(req, res) {
  try {
    var result = await syncAgentsToDb();
    res.json({ sync_completed: true, last_sync: LAST_SYNC, result: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/layers', async function(req, res) {
  try {
    var r = await getPool().query("SELECT agent_layer,count(*) as cnt,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry GROUP BY agent_layer ORDER BY cnt DESC");
    res.json({ layers: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/stats', async function(req, res) {
  try {
    var r = await getPool().query("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted,coalesce(sum(run_count),0) as total_runs,coalesce(sum(success_count),0) as total_success,coalesce(sum(fail_count),0) as total_fails FROM agent_registry");
    var files = scanAgentFiles();
    res.json({ database: r.rows[0], filesystem: { total_files: files.length }, last_sync: LAST_SYNC });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== PHASE 5: SUPERVISOR ===== */
app.get('/api/supervisor/diagnostic', async function(req, res) {
  try {
    var dbStart = Date.now();
    await getPool().query('SELECT 1');
    var dbLatency = Date.now() - dbStart;
    var mem = process.memoryUsage();
    var usedMb = Math.round(mem.rss / 1024 / 1024);
    var totalMb = 512;
    var memPercent = Math.round((usedMb / totalMb) * 100);
    var files = scanAgentFiles();
    var dbAgents = await getPool().query("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry");
    var db = dbAgents.rows[0];
    var agentsSynced = parseInt(db.total, 10) >= files.length;
    var score = 100;
    if (dbLatency > 500) score -= 25; else if (dbLatency > 200) score -= 10;
    if (!agentsSynced) score -= 25;
    if (memPercent > 90) score -= 25; else if (memPercent > 70) score -= 10;
    var faulted = parseInt(db.faulted, 10) || 0;
    if (faulted > 5) score -= 25; else if (faulted > 0) score -= 10;
    score = Math.max(0, score);
    res.json({
      health_score: score,
      health_grade: healthGrade(score),
      checks: {
        database: { status: 'connected', latency_ms: dbLatency, passed: dbLatency < 500 },
        agents: { filesystem: files.length, database: parseInt(db.total, 10), synced: agentsSynced, passed: agentsSynced },
        memory: { used_mb: usedMb, limit_mb: totalMb, percent: memPercent, passed: memPercent < 90 },
        faults: { count: faulted, passed: faulted === 0 }
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/supervisor/status', async function(req, res) {
  try {
    var diag = {};
    var dbStart = Date.now();
    await getPool().query('SELECT 1');
    diag.db_latency_ms = Date.now() - dbStart;
    diag.db_status = 'connected';
    diag.cron_jobs_active = Object.keys(cronJobs).length;
    diag.cron_stats = cronStats;
    diag.last_sync = LAST_SYNC;
    diag.uptime_seconds = Math.floor((Date.now() - START_TIME) / 1000);
    res.json(diag);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== PHASE 5: SCHEDULER ===== */
app.get('/api/scheduler/status', function(req, res) {
  var jobs = [];
  var keys = Object.keys(cronJobs);
  for (var i = 0; i < keys.length; i++) {
    var name = keys[i];
    jobs.push({ name: name, running: true, last_execution: cronStats[name] || null });
  }
  res.json({ active_jobs: jobs.length, jobs: jobs });
});

app.get('/api/scheduler/trigger/:name', async function(req, res) {
  try {
    var name = req.params.name;
    if (name === 'agent-sync') {
      var result = await syncAgentsToDb();
      res.json({ triggered: name, result: result });
    } else if (name === 'agent-heartbeat') {
      var r = await getPool().query("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'");
      res.json({ triggered: name, updated: r.rowCount });
    } else {
      res.status(404).json({ error: 'Unknown job: ' + name, available: ['agent-sync', 'agent-heartbeat'] });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== PHASE 5: SYSTEM PULSE ===== */
app.get('/api/system/pulse', async function(req, res) {
  try {
    var upSec = Math.floor((Date.now() - START_TIME) / 1000);
    var dbStart = Date.now();
    await getPool().query('SELECT 1');
    var dbLat = Date.now() - dbStart;
    var mem = process.memoryUsage();
    var usedMb = Math.round(mem.rss / 1024 / 1024);
    var files = scanAgentFiles();
    var dbA = await getPool().query("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry");
    var d = dbA.rows[0];
    var score = 100;
    if (dbLat > 500) score -= 25;
    if (parseInt(d.total, 10) < files.length) score -= 25;
    if (usedMb > 460) score -= 25;
    if (parseInt(d.faulted, 10) > 0) score -= 25;
    score = Math.max(0, score);
    res.json({
      system: 'TRUNKIA',
      version: '1.0.0',
      phase: 5,
      uptime: formatUptime(upSec),
      uptime_seconds: upSec,
      health_score: score,
      health_grade: healthGrade(score),
      components: {
        database: { status: 'connected', latency_ms: dbLat },
        agents: { total: files.length, deployed: parseInt(d.deployed, 10), faulted: parseInt(d.faulted, 10) },
        scheduler: { active_jobs: Object.keys(cronJobs).length, stats: cronStats },
        memory: { used_mb: usedMb, limit_mb: 512, percent: Math.round((usedMb / 512) * 100) }
      },
      endpoints: 17,
      last_sync: LAST_SYNC,
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/system/metrics', function(req, res) {
  var mem = process.memoryUsage();
  res.json({
    process: {
      pid: process.pid,
      node_version: process.version,
      platform: process.platform,
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000)
    },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024)
    }
  });
});

/* ===== CRON SETUP ===== */
function setupCron(cronLib) {
  if (!cronLib) return;
  try {
    cronJobs['agent-heartbeat'] = cronLib.schedule('*/5 * * * *', async function() {
      try {
        await getPool().query("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'");
        cronStats['agent-heartbeat'] = { last: new Date().toISOString(), status: 'ok' };
      } catch (e) {
        cronStats['agent-heartbeat'] = { last: new Date().toISOString(), status: 'error', error: e.message };
      }
    });
    cronJobs['agent-sync'] = cronLib.schedule('0 * * * *', async function() {
      try {
        var result = await syncAgentsToDb();
        cronStats['agent-sync'] = { last: new Date().toISOString(), status: 'ok', result: result };
      } catch (e) {
        cronStats['agent-sync'] = { last: new Date().toISOString(), status: 'error', error: e.message };
      }
    });
    console.log('Cron: 2 jobs scheduled');
  } catch (e) {
    console.error('[CRON SETUP ERROR] ' + e.message);
  }
}

/* ===== START ===== */
app.listen(PORT, async function() {
  console.log('TRUNKIA Phase5 on :' + PORT);
  try {
    var result = await syncAgentsToDb();
    console.log('Agent sync: ' + result.inserted + ' new, ' + result.updated + ' updated, ' + result.errors + ' errors, ' + result.total_files + ' total files');
  } catch (e) {
    console.error('[STARTUP SYNC ERROR] ' + e.message);
  }
  try {
    var cronMod = await import('node-cron');
    setupCron(cronMod.default || cronMod);
  } catch (e) {
    console.log('[WARN] node-cron not available, scheduler disabled');
  }
});
