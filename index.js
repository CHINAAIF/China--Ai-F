import './config/env.js';
import { holdQuota, settleQuota } from './lib/services/quota-manager.js';
import { sovereignProtocol } from './lib/sovereign-protocol.js';
import { adminGuard } from './lib/admin-guard.js';
import { faultDetectorAgent } from './agents/system/fault-detector-agent.js';
import { selfHealerAgent } from './agents/system/self-healer-agent.js';
import { redTeamAgent } from './agents/system/red-team-agent.js';
import { dlpAgent } from './agents/system/dlp-agent.js';

import { addInferenceJob, getJobStatus } from './lib/job-queue.js';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({ 
    dsn: process.env.SENTRY_DSN, 
    environment: process.env.NODE_ENV || 'development', 
    tracesSampleRate: 1.0 
  });
  console.log('[INFO] Sentry initialized successfully.');
} else {
  console.log('[INFO] SENTRY_DSN not set. Error tracking disabled.');
}

import { runGovernanceMonitor } from './scripts/governance-monitor.js';

import { secureOutput } from "./security_bridge.js";
import { scraperGuard } from "./botDefense.js";
import crypto from 'crypto';
import { getPool as secureGetPool, generateDbToken } from './lib/db.js';
import { sanitizeInput, estimateTokens, classifyTask, executeInference, analyzePromptLocally, sanitizeOutput, logInferenceAsync, getContextMessages, saveContextMessage, logCognitiveTurn, checkAndUpdateSessionRisk, engageHoneypot } from './lib/inference.js';;;
import { checkBehavioralAnomaly, evaluateWithCritics, updateBehavioralBaseline, detectDarkNetwork } from './lib/immune-system.mjs';
import './lib/cognitive-optimizer.mjs';
import { validateApiKeyAndQuota, generateNewApiKey } from './lib/iam-gateway.mjs';
import { strategicIntelligenceAgent } from './agents/intelligence/strategic-intelligence-agent.js';
import { multiModel } from './agents/governance/multi-model.js';
import { semanticCache } from './lib/semantic-cache.js';
import { arxivSentinelAgent } from './agents/intelligence/arxiv-sentinel-agent.js';
import { handleSovereignInference } from './lib/sovereign-inference-router.mjs';
import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cluster from 'cluster';
import os from 'os';
import { safeCron, getGuardianStats, gracefulCronShutdown } from './lib/services/cron-guardian.js';
import { rateLimitMiddleware, getRateLimiterStatus, setRateLimiterPool, destroyRateLimiter } from './lib/services/sovereign-rate-limiter.js';
import { sovereignCommandCenter } from './lib/services/sovereign-command-center.js';
dotenv.config();

var app = express();
app.set('trust proxy', 1);

/* ===== OBSERVABILITY: Sentry Request Handler ===== */
if (process.env.SENTRY_DSN && Sentry.Handlers) { 
// === TRUNKIA-OMEGA PRE-MIDDLEWARE ROUTE (Bypasses TCP DB Deadlock in Termux) ===


app.use(Sentry.Handlers.requestHandler()); }

/* ===== SECURITY: Cloudflare Real IP Extraction (Zero-Trust) ===== */
// يستخرج IP الحقيقي للمستخدم من Cloudflare لضمان عمل Rate Limiting وتتبع المهاجمين بدقة
app.use((req, res, next) => {
  const cfIp = req.headers['cf-connecting-ip'];
  const xff = req.headers['x-forwarded-for'];
  
  if (cfIp) {
    req.realIp = cfIp; // fix: req.ip is a getter-only property in Express, cannot be overwritten
  } else if (xff) {
    req.realIp = xff.split(',')[0].trim();
  } else {
    req.realIp = req.socket.remoteAddress;
  }
  next();
});

var PORT = process.env.PORT || 8080;
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var START_TIME = Date.now();
var LAST_SYNC = null;
var cronJobs = {};
var requestCounter = 0;

/* ===== SECURITY: Helmet ===== */
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } },
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

/* ===== SECURITY: CORS ===== */
/* ===== SECURITY: Strict CORS Policy (Enterprise Grade) ===== */
app.use(cors({
  origin: function(origin, callback) {
    var env = process.env.NODE_ENV || 'development';
    var allowed = (process.env.CORS_ORIGINS || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    
    // 1. في بيئة التطوير فقط، نسمح بكل شيء لتسهيل العمل
    if (env === 'development' && (allowed.indexOf('*') !== -1 || !origin)) {
      return callback(null, true);
    }
    
    // 2. في الإنتاج أو أي بيئة أخرى، يجب أن يكون الأصل (Origin) موجوداً ومصرحاً به صراحة
    if (allowed.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    // 3. رفض أي طلب لا يطابق القائمة البيضاء الصارمة
    if (process.env.NODE_ENV !== 'production' && (!origin || origin.includes('localhost'))) return callback(null, true);
    return callback(new Error('CORS blocked: Strict Origin Policy'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true, // ضروري إذا كنا سنستخدم كوكيز آمنة لاحقاً
  maxAge: 86400
}));

/* ===== SECURITY: Rate Limiting ===== */
var globalLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Rate limit exceeded', retry_after: 60 } });
app.use('/api/', globalLimiter);

/* ===== RESILIENCE: Adaptive Load Shedding (Enterprise Grade) ===== */
// يحمي النظام من الانهيار تحت الضغط: إذا كانت قاعدة البيانات متعطلة أو النظام ينهار، نرفض الطلبات فوراً.
app.use('/api/', (req, res, next) => {
  // 1. إذا كان قاطع الدائرة مفتوحاً (القاعدة بيانات ميتة)، نرفض الطلبات فوراً
  if (circuit.state === 'OPEN') {
    return res.status(503).json({ error: 'Service Unavailable: Circuit Breaker Open', retry_after: 30 });
  }
  // 2. إذا كانت درجة الصحة منخفضة جداً، نحمي النظام من الانهيار
  if (cachedHealth && cachedHealth.score < 40 && req.path !== '/api/system/pulse') {
    return res.status(503).json({ error: 'Service Degraded: Load Shedding Active', retry_after: 15 });
  }
  next();
});

var strictLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Strict rate limit exceeded', retry_after: 60 } });
app.use('/api/self-heal/', strictLimiter);
app.use('/api/scheduler/trigger/', strictLimiter);

/* ===== SECURITY: Body Size ===== */
app.use(express.json({ limit: '100kb' }));
app.use(rateLimitMiddleware());
app.use(scraperGuard);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));


/* ===== SECURITY: Admin Key Generation ===== */
function constantTimeSecretMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length < 32) return false;

  const providedHash = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expected, 'utf8').digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function parseAdminDailyLimit(value) {
  const maxFromEnv = Number(process.env.ADMIN_MAX_DAILY_LIMIT || 100);
  const maxDailyLimit = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 100;

  const rawValue = value === undefined || value === null || value === '' ? 1 : Number(value);

  if (!Number.isFinite(rawValue) || rawValue <= 0 || rawValue > maxDailyLimit) {
    return { ok: false, max: maxDailyLimit };
  }

  return { ok: true, value: Math.round(rawValue * 100) / 100, max: maxDailyLimit };
}

var adminLimiter = rateLimit({
  windowMs: 60000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'ADMIN_RATE_LIMITED', retry_after: 60 }
});

app.post('/api/admin/generate-key', adminLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  try {
    const configuredSecret = process.env.ADMIN_SECRET;

    if (typeof configuredSecret !== 'string' || configuredSecret.length < 32) {
      return res.status(503).json({ success: false, error: 'ADMIN_SECRET_NOT_CONFIGURED' });
    }

    const providedSecret = req.get('x-admin-secret');

    if (!constantTimeSecretMatch(providedSecret, configuredSecret)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN' });
    }

    const parsedLimit = parseAdminDailyLimit(req.body && req.body.daily_limit);

    if (!parsedLimit.ok) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_DAILY_LIMIT',
        max_daily_limit: parsedLimit.max
      });
    }

    const newKey = await generateNewApiKey(null, parsedLimit.value);

    return res.status(201).json({ success: true, api_key: newKey });
  } catch (err) {
    console.error('[ADMIN_KEY_ERROR]', err.message);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }
});


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
  return secureGetPool('main', generateDbToken('index.js'));
}
async function safeQuery(sql, params) {
  if (circuitIsOpen()) throw new Error('CIRCUIT_OPEN: Too many DB failures');
  try { var r = await getPool().query(sql, params); circuitRecordSuccess(); return r; }
  catch (e) { circuitRecordFailure(); throw e; }
}
function sanitize(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 256)
    .replace(/[^a-zA-Z0-9_.,:\-\s]/g, '')
    .trim();
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
function isInfrastructureAgentFile(fileName, fileRel) {
  var rel = String(fileRel || '').replace(/\\/g, '/');
  var name = String(fileName || '').toLowerCase();

  if (!rel || !name) return true;
  if (rel === 'index.js' || rel === 'registry.js') return true;
  if (rel.indexOf('utils/') === 0) return true;
  if (name === 'db.js' || name === 'db-pool.js') return true;
  if (name.indexOf('db-') === 0) return true;
  if (name.endsWith('.backup.js') || name.endsWith('.test.js') || name.endsWith('.spec.js')) return true;

  return false;
}

function isAgentRuntimeFile(fileName, fileRel) {
  return !isInfrastructureAgentFile(fileName, fileRel);
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
    else if (e.isFile() && e.name.endsWith('.js') && isAgentRuntimeFile(e.name, fileRel)) { var nm = e.name.replace('.js', ''); var st; try { st = fs.statSync(full); } catch (ex) { st = { size: 0 }; } results.push({ agent_name: nm, agent_layer: classifyLayer(nm, fileRel), filename: fileRel, file_size: st.size }); }
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


app.post("/v1/chat/completions", async (req, res) => {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  if (!req.is("application/json")) return res.status(415).json({ error: { message: "Unsupported Media Type" } });
  const prompt = req.body?.messages?.slice(-1)[0]?.content || "";
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) return res.status(400).json({ error: { message: "Invalid prompt" } });
  if (prompt.length > 32000) return res.status(413).json({ error: { message: "Prompt too large" } });

  try {
    let authResult;
    try {
      const rawKey = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      authResult = process.env.BYPASS_AUTH === "true" ? { valid: true, userId: "bypass-user", tier: "omega" } : await validateApiKeyAndQuota(rawKey);
    } catch (authErr) { return res.status(500).json({ error: { message: "Auth service unavailable" } }); }
    if (!authResult?.valid) return res.status(401).json({ error: { message: "Unauthorized" } });

    const routingProfile = classifyTask(prompt);
    const isStream = req.body?.stream === true;
    const estimatedHold = 1000;
    let actualCost = 0, inputTokens = 0, outputTokens = 0, modelUsed = routingProfile.tier, tribunalData = null;

    if (process.env.BYPASS_AUTH !== "true") {
      const holdResult = await holdQuota(authResult.userId, estimatedHold, traceId);
      if (!holdResult.success) return res.status(429).json({ error: { message: "Insufficient quota" } });
    }

    if (!isStream) {
      try {
        const result = await sovereignProtocol.execute(prompt, routingProfile.tier, authResult.userId);
        const safeContent = sanitizeOutput(result.content || "");
        return res.json({
          id: "chatcmpl-" + crypto.randomBytes(12).toString("hex"),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: routingProfile.tier,
          choices: [{ index: 0, message: { role: "assistant", content: safeContent }, finish_reason: "stop" }],
          usage: { prompt_tokens: result.attestation?.grounding?.claims || 0, completion_tokens: result.attestation?.grounding?.confidence || 0 },
          attestation: result.attestation || {}
        });
      } catch (execErr) { return res.status(500).json({ error: { message: "Processing failed" } }); }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.flushHeaders) res.flushHeaders();

    const abortController = new AbortController();
    let heartbeatInterval = null, timeoutId = null, streamEnded = false, quotaSettled = false;

    async function settleQuotaSafe() {
      if (quotaSettled) return; quotaSettled = true;
      if (process.env.BYPASS_AUTH === "true" || !authResult?.userId) return;
      try { await settleQuota(authResult.userId, estimatedHold, actualCost, traceId); } catch (e) { quotaSettled = false; }
    }

    async function cleanup(reason) {
      if (streamEnded) return; streamEnded = true;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      try { abortController.abort(); } catch (_) {}
      await settleQuotaSafe();
      if (!res.writableEnded && !res.destroyed) {
        try {
          if (tribunalData) {
            res.write("data: " + JSON.stringify({ id: "chatcmpl-meta", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }], tribunal: tribunalData }) + "\n\n");
          }
          res.write("data: [DONE]\n\n");
        } catch (_) {}
        res.end();
      }
    }

    res.on("error", () => cleanup("res_error"));
    res.on("close", () => { if (!streamEnded && !res.writableEnded) cleanup("client_disconnect"); });
    timeoutId = setTimeout(() => { if (!streamEnded) cleanup("request_timeout"); }, 120000);
    heartbeatInterval = setInterval(() => {
      if (streamEnded || res.writableEnded || res.destroyed) { clearInterval(heartbeatInterval); return; }
      try { res.write(": heartbeat\n\n"); } catch (e) { if (!streamEnded) cleanup("heartbeat_fail"); }
    }, 15000);

    try {
      const stream = sovereignProtocol.executeStream(prompt, routingProfile.tier, authResult.userId, abortController.signal);
      for await (const event of stream) {
        if (streamEnded || res.writableEnded || res.destroyed) break;
        if (event.type === "chunk") {
          let sanitized;
          try { sanitized = sanitizeOutput(String(event.content ?? "")); } catch (sanErr) { sanitized = ""; }
          const ssePayload = { id: "chatcmpl-" + crypto.randomBytes(12).toString("hex"), object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelUsed, choices: [{ index: 0, delta: { content: sanitized }, finish_reason: null }] };
          const payload = "data: " + JSON.stringify(ssePayload) + "\n\n";
          const canWrite = res.write(payload);
          if (!canWrite && !streamEnded) { await new Promise(resolve => res.once("drain", resolve)); }
        } else if (event.type === "metadata") {
          actualCost = event.totalCost || 0;
          inputTokens = event.inputTokens || 0;
          outputTokens = event.outputTokens || 0;
          modelUsed = event.model || modelUsed;
          tribunalData = event.tribunal || null;
        } else if (event.type === "error") {
          if (event.metadata) { actualCost = event.metadata.totalCost || 0; tribunalData = event.metadata.tribunal || null; }
          try { res.write("data: " + JSON.stringify({ error: { message: "Stream processing error" } }) + "\n\n"); } catch (_) {}
        }
      }
      if (!streamEnded) { await cleanup("normal_completion"); }
    } catch (streamErr) {
      if (!streamEnded) { try { res.write("data: " + JSON.stringify({ error: { message: "Stream interrupted" } }) + "\n\n"); } catch (_) {} await cleanup("stream_error"); }
    }
  } catch (err) {
    if (!res.headersSent) { return res.status(500).json({ error: { message: "Internal error" } }); } else if (!res.writableEnded) { res.end(); }
  }
});

app.get('/api/sovereign/rate-limiter/status', function(req, res) {
  res.json(getRateLimiterStatus());
});

app.get('/api/sovereign/command-center', (req, res) => { res.json(sovereignCommandCenter.getFullReport()); });
app.get('/api/sovereign/audit/verify', (req, res) => { res.json(sovereignCommandCenter.verifyChainIntegrity()); });

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


/* ===== SYSTEM ===== */
app.get('/health', function(req, res) { res.json({ status: circuit.state === 'OPEN' ? 'degraded' : 'ok', port: PORT, phase: 7, uptime: fmt(Math.floor((Date.now() - START_TIME) / 1000)), circuit: circuit.state, endpoints: 21, requests_served: requestCounter, time: new Date().toISOString() }); });
app.get('/ping', function(req, res) { res.json({ pong: true, ts: Date.now() }); });

/* ===== INTELLIGENCE ===== */
app.get('/api/intelligence/geopolitical/:slug', async function(req, res) { try { var r = await safeQuery("SELECT m.slug,m.name,g.country_of_origin,g.risk_score,g.data_law_risk,g.sanctions_risk,g.blocking_risk,g.censorship_risk,g.notes,g.assessed_at FROM model_geopolitical_risk g JOIN models m ON g.model_id=m.id WHERE m.slug=$1", [sanitize(sanitize(req.params.slug))]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'Not found' }); updateCachedHealth({ type: 'geo', slug: sanitize(sanitize(req.params.slug)), data: r.rows[0] }); res.json({ model: r.rows[0] }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/cost-calculate', async function(req, res) { try { var slug = sanitize(sanitize(req.query.slug)); var tokens = parseInt(sanitize(sanitize(req.query.tokens)), 10); if (!slug) return res.status(400).json({ error: 'slug required' }); if (!tokens || tokens <= 0) return res.status(400).json({ error: 'tokens must be positive' }); var r = await safeQuery("SELECT m.slug,m.name,p.tier_name,p.pricing_model,p.currency,p.price,p.min_usage,p.max_usage FROM model_pricing_tiers p JOIN models m ON p.model_id=m.id WHERE m.slug=$1 AND p.active=true AND p.deleted_at IS NULL ORDER BY p.min_usage ASC", [slug]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No pricing' }); var sel = null; for (var i = 0; i < r.rows.length; i++) { var mn = parseInt(r.rows[i].min_usage, 10) || 0; var mx = parseInt(r.rows[i].max_usage, 10) || 999999999; if (tokens >= mn && tokens <= mx) { sel = r.rows[i]; break; } } if (!sel) sel = r.rows[r.rows.length - 1]; var up = parseFloat(sel.price) || 0; res.json({ model: { slug: slug, name: r.rows[0].name }, tokens_requested: tokens, matched_tier: sel.tier_name, unit_price: up, total_cost: up * tokens, currency: sel.currency }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/benchmarks', async function(req, res) { try { var slug = sanitize(sanitize(req.query.slug)); if (!slug) return res.status(400).json({ error: 'slug required' }); var r = await safeQuery("SELECT m.slug,m.name,b.benchmark_definition_id,b.score,b.percentile,b.sample_count,b.measured_at FROM model_benchmarks b JOIN models m ON b.model_id=m.id WHERE m.slug=$1 ORDER BY b.measured_at DESC", [slug]); res.json({ model: slug, benchmark_count: (r && r.rows) ? r.rows.length : 0, benchmarks: (r && r.rows) ? r.rows : [] }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/compare', async function(req, res) { try { var slugs = (sanitize(sanitize(req.query.slugs)) || '').split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; }); if (slugs.length < 2) return res.status(400).json({ error: 'Min 2 slugs' }); if (slugs.length > 5) return res.status(400).json({ error: 'Max 5 slugs' }); var mr = await safeQuery("SELECT id,slug,name,model_type,parameter_count,context_window,is_open_source,status FROM models WHERE slug=ANY($1)", [slugs]); var results = []; for (var i = 0; i < mr.rows.length; i++) { var m = mr.rows[i]; var br = await safeQuery("SELECT benchmark_definition_id,score,percentile FROM model_benchmarks WHERE model_id=$1", [m.id]); results.push({ slug: m.slug, name: m.name, model_type: m.model_type, context_window: m.context_window, is_open_source: m.is_open_source, status: m.status, benchmark_count: (br && br.rows) ? br.rows.length : 0, benchmarks: (br && br.rows) ? br.rows : [] }); } res.json({ compared: results.length, models: results }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/intelligence/safety/:slug', async function(req, res) { try { var r = await safeQuery("SELECT m.slug,m.name,c.capability,c.description,c.details FROM model_capabilities c JOIN models m ON c.model_id=m.id WHERE m.slug=$1", [sanitize(sanitize(req.params.slug))]); if (!r || !r.rows || !r.rows.length) return res.status(404).json({ error: 'No capabilities' }); res.json({ model: { slug: sanitize(sanitize(req.params.slug)), name: r.rows[0].name }, capability_count: r.rows.length, capabilities: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== AGENTS ===== */
app.get('/api/agents', async function(req, res) { try { var layer = sanitize(sanitize(req.query.layer)); var status = sanitize(sanitize(req.query.status)); var q = "SELECT agent_name,agent_layer,status,model_provider,last_run,run_count,success_count,fail_count,avg_duration_ms,config,created_at FROM agent_registry"; var params = []; var conds = []; if (layer) { conds.push("agent_layer=$" + (params.length + 1)); params.push(layer); } if (status) { conds.push("status=$" + (params.length + 1)); params.push(status); } if (conds.length > 0) q += " WHERE " + conds.join(" AND "); q += " ORDER BY agent_name ASC"; var r = await safeQuery(q, params.length > 0 ? params : undefined); res.json({ count: r.rows.length, agents: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/sync', async function(req, res) { try { var result = await syncAgentsToDb(); res.json({ sync_completed: true, last_sync: LAST_SYNC, result: result }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/layers', async function(req, res) { try { var r = await safeQuery("SELECT agent_layer,count(*) as cnt,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry GROUP BY agent_layer ORDER BY cnt DESC"); res.json({ layers: r.rows }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/agents/stats', async function(req, res) { try { var r = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted,coalesce(sum(run_count),0) as total_runs FROM agent_registry"); var files = scanAgentFiles(); res.json({ database: r.rows[0], filesystem: { total_files: files.length }, last_sync: LAST_SYNC }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== SUPERVISOR ===== */
app.get('/api/supervisor/diagnostic', adminGuard, async function(req, res) { try { var dbS = Date.now(); await safeQuery('SELECT 1'); var dbL = Date.now() - dbS; var mem = process.memoryUsage(); var usedMb = Math.round(mem.rss / 1024 / 1024); var files = scanAgentFiles(); var dbA = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry"); var d = dbA.rows[0]; var sc = 100; if (dbL > 500) sc -= 25; if (parseInt(d.total, 10) < files.length) sc -= 25; if (usedMb > 460) sc -= 25; if (parseInt(d.faulted, 10) > 0) sc -= 15; if (circuit.state !== 'CLOSED') sc -= 10; sc = Math.max(0, sc); res.json({ health_score: sc, health_grade: grade(sc), circuit: { state: circuit.state, failures: circuit.failures }, checks: { database: { status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', latency_ms: dbL, passed: dbL < 500 }, agents: { filesystem: files.length, database: parseInt(d.total, 10), synced: parseInt(d.total, 10) >= files.length, passed: parseInt(d.total, 10) >= files.length }, memory: { used_mb: usedMb, percent: Math.round((usedMb / 512) * 100), passed: usedMb < 460 }, faults: { count: parseInt(d.faulted, 10), passed: parseInt(d.faulted, 10) === 0 }, circuit: { state: circuit.state, passed: circuit.state === 'CLOSED' } }, security: { helmet: true, rate_limit: '120/min global, 20/min strict', cors: 'enabled', body_limit: '100kb' }, timestamp: new Date().toISOString() }); } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });
app.get('/api/supervisor/status', adminGuard, async function(req, res) { try { var dbS = Date.now(); await safeQuery('SELECT 1'); res.json({ db_latency_ms: Date.now() - dbS, db_status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', circuit: circuit, cron_jobs_active: Object.keys(cronJobs).length, cron_stats: getGuardianStats(), last_sync: LAST_SYNC, requests_served: requestCounter, uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000) }); } catch (e) { res.json({ db_status: 'error', circuit: circuit, error: e.message }); } });

/* ===== SCHEDULER ===== */
app.get('/api/scheduler/status', adminGuard, function(req, res) { var jobs = []; var k = Object.keys(cronJobs); for (var i = 0; i < k.length; i++) jobs.push({ name: k[i], running: true, last_execution: getGuardianStats()[k[i]] || null }); res.json({ active_jobs: jobs.length, jobs: jobs }); });
app.get('/api/scheduler/trigger/:name', adminGuard, async function(req, res) { try { var n = sanitize(sanitize(req.params.name)); if (n === 'agent-sync') { var r = await syncAgentsToDb(); res.json({ triggered: n, result: r }); } else if (n === 'agent-heartbeat') { var r2 = await safeQuery("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'"); res.json({ triggered: n, updated: r2.rowCount }); } else if (n === 'self-heal') { var h = await selfHeal(); res.json({ triggered: n, result: h }); } else { res.status(404).json({ error: 'Unknown job', available: ['agent-sync', 'agent-heartbeat', 'self-heal'] }); } } catch (e) { res.status(503).json({ error: e.message, circuit: circuit.state }); } });

/* ===== SYSTEM PULSE ===== */
// فحص صحة بسيط وعام - يستخدمه Docker وRailway، لا يحتاج مصادقة
app.get('/healthz', function(req, res) {
  res.status(200).json({ status: 'ok', service: 'TRUNKIA', timestamp: new Date().toISOString() });
});

app.get('/api/system/pulse', adminGuard, async function(req, res) { try { var upSec = Math.floor((Date.now() - START_TIME) / 1000); var dbS = Date.now(); await safeQuery('SELECT 1'); var dbL = Date.now() - dbS; var mem = process.memoryUsage(); var usedMb = Math.round(mem.rss / 1024 / 1024); var files = scanAgentFiles(); var dbA = await safeQuery("SELECT count(*) as total,count(*) FILTER (WHERE status='DEPLOYED') as deployed,count(*) FILTER (WHERE status='FAULT_ISOLATED') as faulted FROM agent_registry"); var d = dbA.rows[0]; var sc = 100; if (dbL > 500) sc -= 25; if (parseInt(d.total, 10) < files.length) sc -= 25; if (usedMb > 460) sc -= 25; if (parseInt(d.faulted, 10) > 0) sc -= 15; if (circuit.state !== 'CLOSED') sc -= 10; sc = Math.max(0, sc); updateCachedHealth({ score: sc, grade: grade(sc) }); res.json({ system: 'TRUNKIA', version: '1.0.0', phase: 7, uptime: fmt(upSec), uptime_seconds: upSec, health_score: sc, health_grade: grade(sc), components: { database: { status: circuit.state === 'OPEN' ? 'circuit_open' : 'connected', latency_ms: dbL }, agents: { total: files.length, deployed: parseInt(d.deployed, 10), faulted: parseInt(d.faulted, 10) }, scheduler: { active_jobs: Object.keys(cronJobs).length, stats: getGuardianStats() }, memory: { used_mb: usedMb, limit_mb: 512, percent: Math.round((usedMb / 512) * 100) }, circuit_breaker: { state: circuit.state, failures: circuit.failures }, security: { helmet: true, rate_limit_active: true, cors_enabled: true } }, endpoints: 21, requests_served: requestCounter, last_sync: LAST_SYNC, timestamp: new Date().toISOString() }); } catch (e) { var fb = cachedHealth || { score: 0, grade: 'F' }; res.status(503).json({ degraded: true, cached_health: fb, error: e.message, circuit: circuit.state, timestamp: new Date().toISOString() }); } });
app.post('/api/inference', handleSovereignInference);
app.post('/api/intelligence/strategic-analysis', async (req, res) => {
  try {
    const result = await strategicIntelligenceAgent.analyzeMarket(req.body.pricing, req.body.benchmarks, req.body.risks);
    if (result.success === false) return res.status(500).json({ error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/system/metrics', adminGuard, function(req, res) { var mem = process.memoryUsage(); res.json({ process: { pid: process.pid, node_version: process.version, platform: process.platform, uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000), requests_served: requestCounter }, memory: { rss_mb: Math.round(mem.rss / 1024 / 1024), heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024), heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024) }, security: { helmet: true, rate_limit: '120/min', cors: true, body_limit: '100kb' } }); });

/* ===== SELF-HEAL + CIRCUIT ===== */
app.get('/api/self-heal/run', adminGuard, async function(req, res) { try { var r = await selfHeal(); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/self-heal/status', adminGuard, function(req, res) { res.json({ circuit_breaker: { state: circuit.state, failures: circuit.failures, last_failure: circuit.lastFailure ? new Date(circuit.lastFailure).toISOString() : null, failure_threshold: circuit.failureThreshold, reset_timeout_ms: circuit.resetTimeoutMs, success_threshold: circuit.successThreshold }, cached_health: cachedHealth, cache_age_seconds: cacheTime ? Math.floor((Date.now() - cacheTime) / 1000) : null }); });
app.get('/api/self-heal/circuit/reset', adminGuard, function(req, res) { circuit.state = 'CLOSED'; circuit.failures = 0; circuit.halfOpenSuccesses = 0; res.json({ circuit: 'reset', new_state: 'CLOSED' }); });


app.post('/api/intelligence/arxiv-scan', async (req, res) => {
  try {
    const result = await arxivSentinelAgent.scan(req.body.topic);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ===== OBSERVABILITY: Sentry Error Handler ===== */
// يجب أن يكون قبل أي مسار 404 أو معالج أخطاء آخر
if (process.env.SENTRY_DSN && Sentry.Handlers) { app.use(Sentry.Handlers.errorHandler()); }


/* ===== ASYNC INFERENCE QUEUE (Enterprise Distributed) ===== */
app.post('/api/inference/queue', async (req, res) => {
  try {
    if (!process.env.REDIS_URL) {
      return res.status(503).json({ error: 'Queue service unavailable (Redis not configured)' });
    }
    const jobId = await addInferenceJob(req.body);
    res.status(202).json({ job_id: jobId, status: 'pending', message: 'Inference scheduled. Poll /api/inference/status/:id to get the result.' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to enqueue inference job', details: e.message });
  }
});

app.get('/api/inference/status/:id', async (req, res) => {
  try {
    const job = await getJobStatus(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/* ===== OBSERVABILITY: Inference Gateway Health ===== */
app.get('/api/llm/health', adminGuard, (req, res) => {
  try {
    const health = multiModel.getHealthStatus();
    res.json({ providers: health, total_providers: health.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/* ===== OBSERVABILITY: Semantic Cache & Cost Analytics ===== */
app.get('/api/llm/cache-stats', adminGuard, (req, res) => {
  try {
    res.json(semanticCache.getStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== 404 HANDLER ===== */
app.use(function(req, res) {
  res.status(404).json({ error: 'Not found', request_id: req._requestId || 'unknown' });
});

/* ===== CRON (Guardian v2.0) ===== */
function setupCron(cl) {
  if (!cl) return;
  try {
    cronJobs['agent-heartbeat'] = cl.schedule('*/5 * * * *', safeCron('agent-heartbeat', async function() { try { await safeQuery("UPDATE agent_registry SET last_run=NOW() WHERE status='DEPLOYED'"); getGuardianStats()['agent-heartbeat'] = { last: new Date().toISOString(), status: 'ok' }; } catch (e) { getGuardianStats()['agent-heartbeat'] = { last: new Date().toISOString(), status: 'error', error: e.message }; } }));
    cronJobs['agent-sync'] = cl.schedule('0 * * * *', safeCron('agent-sync', async function() { try { var r = await syncAgentsToDb(); getGuardianStats()['agent-sync'] = { last: new Date().toISOString(), status: 'ok' }; } catch (e) { getGuardianStats()['agent-sync'] = { last: new Date().toISOString(), status: 'error' }; } }));
    cronJobs['self-heal'] = cl.schedule('*/15 * * * *', safeCron('self-heal', async function() { try { var r = await selfHeal(); getGuardianStats()['self-heal'] = { last: new Date().toISOString(), status: 'ok', healed: r.healed }; } catch (e) { getGuardianStats()['self-heal'] = { last: new Date().toISOString(), status: 'error' }; } }));
    cronJobs['governance-monitor'] = cl.schedule('0 */6 * * *', safeCron('governance-monitor', async function() { try { await runGovernanceMonitor(); getGuardianStats()['governance-monitor'] = { last: new Date().toISOString(), status: 'ok' }; } catch (e) { getGuardianStats()['governance-monitor'] = { last: new Date().toISOString(), status: 'error' }; } }));
    // Sensory Agents (تعمل كل ساعة)
    cronJobs['arxiv-sentinel'] = cl.schedule('0 * * * *', safeCron('arxiv-sentinel', async function() { try { await arxivSentinelAgent.run('Artificial Intelligence'); } catch (e) { console.error('[ARXIV SENTINEL ERR]', e.message); } }));
    cronJobs['china-news'] = cl.schedule('30 * * * *', safeCron('china-news', async function() { try { await chinaNewsAgent.run(); } catch (e) { console.error('[CHINA NEWS ERR]', e.message); } }));
    
    // System Swarm Agents (تعمل في الخلفية)
    cronJobs['fault-detector'] = cl.schedule('* * * * *', safeCron('fault-detector', async function() { try { await faultDetectorAgent.run(); } catch (e) { console.error('[FAULT DETECTOR ERR]', e.message); } }));
    cronJobs['self-healer'] = cl.schedule('* * * * *', safeCron('self-healer', async function() { try { await selfHealerAgent.run(); } catch (e) { console.error('[SELF HEALER ERR]', e.message); } }));
    cronJobs['red-team'] = cl.schedule('0 * * * *', safeCron('red-team', async function() { try { await redTeamAgent.run(); } catch (e) { console.error('[RED TEAM ERR]', e.message); } }));
    cronJobs['dlp-stats'] = cl.schedule('0 */6 * * *', safeCron('dlp-stats', async function() { try { await dlpAgent.run(); } catch (e) { console.error('[DLP STATS ERR]', e.message); } }));
    
    cronJobs['strategic-analyst'] = cl.schedule('0 */2 * * *', safeCron('strategic-analyst', async function() { try { await strategicAnalystAgent.run(); } catch (e) { console.error('[STRATEGIC ANALYST ERR]', e.message); } }));
    cronJobs['adversarial-verifier'] = cl.schedule('0 */3 * * *', safeCron('adversarial-verifier', async function() { try { await adversarialVerifierAgent.run(); } catch (e) { console.error('[ADVERSARIAL VERIFIER ERR]', e.message); } }));
    cronJobs['sovereign-decision'] = cl.schedule('0 */4 * * *', safeCron('sovereign-decision', async function() { try { await sovereignDecisionAgent.run(); } catch (e) { console.error('[SOVEREIGN DECISION ERR]', e.message); } }));
    console.log('Cron: 13 jobs scheduled (Sovereign Decision active)');
  } catch (e) { console.error('[CRON ERR]', e.message); }
}

/* ===== SOVEREIGN CLUSTER MODE (Enterprise Scaling) ===== */
if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
  // MASTER PROCESS: Manages workers and runs background jobs exclusively
  const numCPUs = os.cpus().length;
  console.log('[SOVEREIGN CLUSTER] Master process starting ' + numCPUs + ' workers...');
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.warn('[SOVEREIGN CLUSTER] Worker ' + worker.process.pid + ' died. Restarting...');
    cluster.fork();
  });
  
  // Master runs background sync and cron
  (async () => {
    try { 
      var r = await syncAgentsToDb(); 
      console.log('Sync: ' + r.inserted + ' new, ' + r.updated + ' updated, ' + r.total_files + ' total'); 
    } catch (e) { console.error('[SYNC ERR]', e.message); }
    
    try { 
      var cm = await import('node-cron'); 
      setupCron(cm.default || cm); 
      console.log('[SOVEREIGN CLUSTER] Master background jobs initialized.');
    } catch (e) { console.log('[WARN] node-cron not available'); }
  })();
  
} else {
  // WORKER PROCESS (or Standalone in Staging): Handles HTTP traffic only
  app.listen(PORT, async function() {
    console.log('[TRUNKIA] Worker ' + process.pid + ' listening on :' + PORT);
    
    // In staging (single thread), we still run crons here for testing
    if (process.env.NODE_ENV !== 'production') {
      try { 
        var r = await syncAgentsToDb(); 
        console.log('Sync: ' + r.inserted + ' new, ' + r.updated + ' updated, ' + r.total_files + ' total'); 
      } catch (e) { console.error('[SYNC ERR]', e.message); }
      
      try { 
        var cm = await import('node-cron'); 
        setupCron(cm.default || cm); 
      } catch (e) { console.log('[WARN] node-cron not available'); }
    }
  });
}

