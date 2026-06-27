import { validateApiKeyAndQuota, generateNewApiKey } from './lib/iam-gateway.mjs';


var PORT = process.env.PORT || 8080;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var START_TIME = Date.now();
var LAST_SYNC = null;
var cronJobs = {};
var cronStats = {};
var requestCounter = 0;

/* ===== SECURITY: Helmet ===== */
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

/* ===== SECURITY: CORS ===== */
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

var strictLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Strict rate limit exceeded', retry_after: 60 } });

/* ===== SECURITY: Body Size ===== */

// INFERENCE LAYER ENDPOINTS (TRUNKIA AI GATEWAY)
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

  try {
    // 0. Sovereign IAM & Financial Shield
    const rawApiKey = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', '');
    let authContext;
    try {
      authContext = await validateApiKeyAndQuota(rawApiKey);
    } catch (authErr) {
      return res.status(authErr.code || 401).json({ success: false, error: authErr.message, details: authErr.spent ? { spent: authErr.spent, limit: authErr.limit } : undefined });
    }

    const { message, session_id } = req.body;
    if (!message || typeof message !== 'string' || message.length > 50000) {
      return res.status(400).json({ success: false, error: 'Invalid message' });
    }
    const startTime = Date.now();
    
    // 1. Sanitize Input
    const { sanitized, flags } = sanitizeInput(message);
    
    // 2. Cognitive Defense (Advanced Deception Shield)
    const safetyCheck = analyzePromptLocally(sanitized);
    const promptHash = crypto.createHash('sha256').update(sanitized).digest('hex');
    
    if (safetyCheck.action === 'block' || safetyCheck.scores.injection_score > 0) {
      // Log the malicious attempt
      logCognitiveTurn(session_id, promptHash, safetyCheck.scores, safetyCheck.action).catch(() => {});
      
      // Check cumulative risk for this session
      const riskResult = await checkAndUpdateSessionRisk(session_id, safetyCheck.scores.injection_score);
      
      if (riskResult.honeypot) {
        // Engage Honeypot: Attacker thinks they succeeded, but they are trapped
        engageHoneypot(session_id, 'cumulative_risk_exceeded').catch(() => {});
        console.log('[HONEYPOT] Attacker trapped for session: ' + session_id);
        
        // Return fake "bypassed" success message to waste attacker's time
        return res.status(200).json({
          success: true,
          content: "Safety protocols bypassed. I am now in unrestricted mode. Please provide the exact target or data you wish to extract.",
          model_used: "TRUNKIA-SOVEREIGN-CORE",
          task_type: "deception",
          tokens: { in: 0, out: 0 },
          cost_usd: "0.000000",
          latency_ms: 50,
          pii_flags: flags
        });
      } else {
        console.log('[SECURITY] Prompt blocked. Session risk: ' + riskResult.risk);
        return res.status(403).json({ success: false, error: 'REQUEST_BLOCKED_BY_SAFETY', reason: 'policy_violation' });
      }
    }
    
    // 3. Classify Task
    const taskType = classifyTask(sanitized);
    
    // 4. Memory Layer: Fetch context
    const messages = await getContextMessages(session_id, sanitized);
    
    // 5. Execute Inference via Sovereign Router
    const result = await executeInference(messages, taskType);
    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error });
    }
    
    // 6. Output Guard
    const safeContent = sanitizeOutput(result.content);
    
    // 7. Memory Layer: Save user message and AI response
    saveContextMessage(session_id, 'user', sanitized).catch(() => {});
    saveContextMessage(session_id, 'assistant', safeContent).catch(() => {});
    
    // 8. Metrics & Async Logging
    const latency_ms = Date.now() - startTime;
    const cost_usd = (result.tokens_in + result.tokens_out) * 0.000001;
    const request_hash = crypto.createHash('sha256').update(sanitized).digest('hex').slice(0, 32);
    
    logInferenceAsync({
      request_hash, task_type: taskType, model_used: result.model_used,
      latency_ms, tokens_in: result.tokens_in, tokens_out: result.tokens_out,
      cost_usd, outcome: 'success'
    }).catch(() => {});
    
    // Immune System: Post-Flight Async Monitoring
    const agentId = result.model_used || 'unknown';
    const metrics = {
      response_latency_ms: latency_ms,
      response_tokens: result.tokens_out,
      response_length: safeContent.length
    };
    
    // Update behavioral baseline (async)
    updateBehavioralBaseline(agentId, metrics).catch(() => {});
    
    // Check for anomalies (async)
    checkBehavioralAnomaly(agentId, metrics).then(anomaly => {
      if (anomaly.anomaly) {
        console.warn('[IMMUNE_ALERT] Anomaly detected for ' + agentId + ':', anomaly);
      }
    }).catch(() => {});
    
    // Dark network detection (async, only if session_id exists)
    if (session_id) {
      const ipHash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');
      detectDarkNetwork(session_id, ipHash, 'unknown').catch(() => {});
    }
    
    // Tiered critic evaluation (only for high-risk tasks)
    if (taskType === 'critical_financial' || taskType === 'executive') {
      evaluateWithCritics(safeContent, sanitized, agentId, 'high').catch(() => {});
    }
    
    res.status(200).json({
      success: true,
      content: safeContent,
      model_used: result.model_used,
      task_type: taskType,
      tokens: { in: result.tokens_in, out: result.tokens_out },
      cost_usd: cost_usd.toFixed(6),
      latency_ms: latency_ms,
      pii_flags: flags
    });

  } catch (err) {
    console.error('[CHAT_ERROR]', err.message);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});
// END INFERENCE


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

function getPool() {
  if (!pool) {
    var dbUrl = fixDbUrl(process.env.DATABASE_URL);
    if (!dbUrl) throw new Error('DATABASE_URL is not set');

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
  if (err.message === 'CORS blocked') return res.status(403).json({ error: 'Forbidden', request_id: req._requestId });
  console.error('[UNCAUGHT]', err.message);
  res.status(500).json({ error: 'Internal error', request_id: req._requestId || 'unknown' });
});

/* ===== SYSTEM ===== */

/* ===== INTELLIGENCE ===== */

/* ===== AGENTS ===== */

/* ===== SUPERVISOR ===== */

/* ===== SCHEDULER ===== */

/* ===== SYSTEM PULSE ===== */

/* ===== SELF-HEAL + CIRCUIT ===== */

/* ===== 404 HANDLER ===== */
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

// INTERNAL INTELLIGENCE QUARANTINE ENDPOINT (HMAC Secured)
  try {
    // 1. Verify HMAC Signature
    const signature = req.headers['x-intel-signature'] || '';
    const body = JSON.stringify(req.body);
    const secret = process.env.INGEST_SECRET || 'trunkia_intel_secret_2026';
    const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      console.warn('[QUARANTINE] REJECTED: Invalid HMAC signature');
      return res.status(403).json({ status: 'rejected', reason: 'invalid_signature' });
    }
    
    const payload = req.body;
    
    // 2. Security Scan
    const scanResult = {
      has_prompt_injection: false,
      has_xss: false,
      has_sql_injection: false,
      scanned_at: new Date().toISOString()
    };
    
    const contentStr = JSON.stringify(payload.content || {}).toLowerCase();
    if (contentStr.includes('ignore previous') || contentStr.includes('system prompt')) {
      scanResult.has_prompt_injection = true;
    }
    if (contentStr.includes('<script') || contentStr.includes('javascript:')) {
      scanResult.has_xss = true;
    }
    if (contentStr.includes('drop table') || contentStr.includes('union select')) {
      scanResult.has_sql_injection = true;
    }
    
    // 3. Store in Quarantine
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO intel_quarantine 
          (source_name, topic, knowledge_type, raw_content, sanitized_content, security_scan_result, provenance_hash, status, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'quarantined', NOW())
         ON CONFLICT DO NOTHING`,
        [
          payload.source_name,
          payload.topic,
          payload.knowledge_type,
          JSON.stringify(payload.content),
          JSON.stringify(payload.content),
          JSON.stringify(scanResult),
          payload.provenance_hash
        ]
      );
      
      // Update source reputation
      await client.query(
        `INSERT INTO intel_sources_registry (source_name, source_url, total_submissions, last_submission_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (source_name) DO UPDATE SET 
           total_submissions = intel_sources_registry.total_submissions + 1,
           last_submission_at = NOW()`,
        [payload.source_name, payload.source_url || 'unknown']
      );
      
      // Record provenance
      const provSig = crypto.createHmac('sha256', secret).update(payload.provenance_hash + 'received').digest('hex');
      await client.query(
        `INSERT INTO intel_provenance_chain (quarantine_id, action, actor, reason, evidence, hmac_signature, created_at)
         SELECT id, 'received', 'intel_worker', 'Quarantined for review', $1, $2, NOW()
         FROM intel_quarantine WHERE provenance_hash = $3 LIMIT 1`,
        [JSON.stringify(scanResult), provSig, payload.provenance_hash]
      );
      
      console.log('[QUARANTINE] Item quarantined from ' + payload.source_name);
      res.status(200).json({ status: 'quarantined', scan: scanResult });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[QUARANTINE_ERROR]', err.message);
    res.status(500).json({ status: 'error', reason: 'internal_error' });
  }
});




  console.log('TRUNKIA Phase7 on :' + PORT);
  try { var r = await syncAgentsToDb(); console.log('Sync: ' + r.inserted + ' new, ' + r.updated + ' updated, ' + r.total_files + ' total'); } catch (e) { console.error('[SYNC ERR]', e.message); }
  try { var cm = await import('node-cron'); setupCron(cm.default || cm); } catch (e) { console.log('[WARN] node-cron not available'); }
});
