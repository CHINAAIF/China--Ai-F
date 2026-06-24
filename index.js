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

/* ===== AGENT SCANNER ===== */
function scanAgentFiles() {
  var agentDir = path.join(__dirname, 'agents');
  if (!fs.existsSync(agentDir)) return [];
  var files = fs.readdirSync(agentDir);
  var agents = [];
  for (var i = 0; i < files.length; i++) {
    if (!files[i].endsWith('.js')) continue;
    var name = files[i].replace('.js', '');
    var layer = 'autonomous';
    var ln = name.toLowerCase();
    if (ln.indexOf('brain') !== -1 || ln.indexOf('memory') !== -1 || ln.indexOf('knowledge') !== -1) layer = 'cognitive';
    else if (ln.indexOf('security') !== -1 || ln.indexOf('shield') !== -1 || ln.indexOf('firewall') !== -1) layer = 'security';
    else if (ln.indexOf('log') !== -1 || ln.indexOf('diag') !== -1 || ln.indexOf('inspect') !== -1 || ln.indexOf('monitor') !== -1) layer = 'observability';
    else if (ln.indexOf('registry') !== -1 || ln.indexOf('task') !== -1 || ln.indexOf('scheduler') !== -1 || ln.indexOf('queue') !== -1) layer = 'orchestration';
    else if (ln.indexOf('verif') !== -1 || ln.indexOf('valid') !== -1 || ln.indexOf('audit') !== -1) layer = 'validation';
    else if (ln.indexOf('fix') !== -1 || ln.indexOf('patch') !== -1 || ln.indexOf('repair') !== -1 || ln.indexOf('heal') !== -1) layer = 'repair';
    else if (ln.indexOf('govern') !== -1 || ln.indexOf('sovereign') !== -1 || ln.indexOf('policy') !== -1) layer = 'governance';
    var stat = fs.statSync(path.join(agentDir, files[i]));
    agents.push({ agent_name: name, agent_layer: layer, filename: files[i], file_size: stat.size });
  }
  return agents;
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
    } catch (e) {
      errors++;
      console.error('[SYNC ERR] ' + a.agent_name + ': ' + e.message);
    }
  }
  return { total_files: agents.length, inserted: synced, updated: updated, errors: errors };
}

/* ===== SYSTEM ROUTES ===== */
app.get('/health', function(req, res) {
  res.json({ status: 'ok', port: PORT, phase: 4, time: new Date().toISOString() });
});

app.get('/ping', function(req, res) {
  res.json({ pong: true, ts: Date.now() });
});

/* ===== PHASE 3 ENDPOINTS ===== */
app.get('/api/intelligence/geopolitical/:slug', async function(req, res) {
  try {
    var r = await getPool().query("SELECT m.slug, m.name, g.country_of_origin, g.risk_score, g.data_law_risk, g.sanctions_risk, g.blocking_risk, g.censorship_risk, g.notes, g.assessed_at FROM model_geopolitical_risk g JOIN models m ON g.model_id = m.id WHERE m.slug = $1", [req.params.slug]);
    if (!r || !r.rows || r.rows.length === 0) return res.status(404).json({ error: 'Model not found' });
    res.json({ model: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/cost-calculate', async function(req, res) {
  try {
    var slug = req.query.slug;
    var tokens = parseInt(req.query.tokens, 10);
    if (!slug) return res.status(400).json({ error: 'slug required' });
    if (!tokens || tokens <= 0) return res.status(400).json({ error: 'tokens must be positive' });
    var r = await getPool().query("SELECT m.slug, m.name, p.tier_name, p.pricing_model, p.currency, p.price, p.min_usage, p.max_usage FROM model_pricing_tiers p JOIN models m ON p.model_id = m.id WHERE m.slug = $1 AND p.active = true AND p.deleted_at IS NULL ORDER BY p.min_usage ASC", [slug]);
    if (!r || !r.rows || r.rows.length === 0) return res.status(404).json({ error: 'No pricing found' });
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
    var r = await getPool().query("SELECT m.slug, m.name, b.benchmark_definition_id, b.score, b.percentile, b.sample_count, b.measured_at FROM model_benchmarks b JOIN models m ON b.model_id = m.id WHERE m.slug = $1 ORDER BY b.measured_at DESC", [slug]);
    res.json({ model: slug, benchmark_count: (r && r.rows) ? r.rows.length : 0, benchmarks: (r && r.rows) ? r.rows : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/compare', async function(req, res) {
  try {
    var slugs = (req.query.slugs || '').split(',').map(function(s){return s.trim();}).filter(function(s){return s.length>0;});
    if (slugs.length < 2) return res.status(400).json({ error: 'Min 2 slugs' });
    if (slugs.length > 5) return res.status(400).json({ error: 'Max 5 slugs' });
    var mr = await getPool().query("SELECT id, slug, name, model_type, parameter_count, context_window, is_open_source, status FROM models WHERE slug = ANY($1)", [slugs]);
    var results = [];
    for (var i = 0; i < mr.rows.length; i++) {
      var m = mr.rows[i];
      var br = await getPool().query("SELECT benchmark_definition_id, score, percentile FROM model_benchmarks WHERE model_id = $1", [m.id]);
      results.push({ slug: m.slug, name: m.name, model_type: m.model_type, context_window: m.context_window, is_open_source: m.is_open_source, status: m.status, benchmark_count: (br && br.rows) ? br.rows.length : 0, benchmarks: (br && br.rows) ? br.rows : [] });
    }
    res.json({ compared: results.length, models: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/intelligence/safety/:slug', async function(req, res) {
  try {
    var r = await getPool().query("SELECT m.slug, m.name, c.capability, c.description, c.details FROM model_capabilities c JOIN models m ON c.model_id = m.id WHERE m.slug = $1", [req.params.slug]);
    if (!r || !r.rows || r.rows.length === 0) return res.status(404).json({ error: 'No capabilities found' });
    res.json({ model: { slug: req.params.slug, name: r.rows[0].name }, capability_count: r.rows.length, capabilities: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== PHASE 4: AGENT REGISTRY ===== */
app.get('/api/agents', async function(req, res) {
  try {
    var layer = req.query.layer;
    var status = req.query.status;
    var q = "SELECT agent_name, agent_layer, status, model_provider, last_run, run_count, success_count, fail_count, avg_duration_ms, config, created_at FROM agent_registry";
    var params = [];
    var conditions = [];
    if (layer) { conditions.push("agent_layer = $" + (params.length + 1)); params.push(layer); }
    if (status) { conditions.push("status = $" + (params.length + 1)); params.push(status); }
    if (conditions.length > 0) q += " WHERE " + conditions.join(" AND ");
    q += " ORDER BY agent_name ASC";
    var r = await getPool().query(q, params.length > 0 ? params : undefined);
    res.json({ count: r.rows.length, agents: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/sync', async function(req, res) {
  try {
    var result = await syncAgentsToDb();
    res.json({ sync_completed: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/layers', async function(req, res) {
  try {
    var r = await getPool().query("SELECT agent_layer, count(*) as cnt, count(*) FILTER (WHERE status = 'DEPLOYED') as deployed, count(*) FILTER (WHERE status = 'FAULT_ISOLATED') as faulted FROM agent_registry GROUP BY agent_layer ORDER BY cnt DESC");
    res.json({ layers: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/stats', async function(req, res) {
  try {
    var r = await getPool().query("SELECT count(*) as total, count(*) FILTER (WHERE status = 'DEPLOYED') as deployed, count(*) FILTER (WHERE status = 'FAULT_ISOLATED') as faulted, count(*) FILTER (WHERE status = 'SANDBOX_ACTIVE') as sandbox, coalesce(sum(run_count), 0) as total_runs, coalesce(sum(success_count), 0) as total_success, coalesce(sum(fail_count), 0) as total_fails, coalesce(avg(avg_duration_ms), 0) as avg_duration FROM agent_registry");
    var files = scanAgentFiles();
    res.json({ database: r.rows[0], filesystem: { total_files: files.length } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== START ===== */
app.listen(PORT, async function() {
  console.log('TRUNKIA Phase4 on :' + PORT);
  try {
    var result = await syncAgentsToDb();
    console.log('Agent sync: ' + result.inserted + ' new, ' + result.updated + ' updated, ' + result.errors + ' errors');
  } catch (e) {
    console.error('[STARTUP SYNC ERROR] ' + e.message);
  }
});
