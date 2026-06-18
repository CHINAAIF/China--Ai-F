import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { body, validationResult } from 'express-validator';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import pg from 'pg';
import { agentExecute } from './ai-governor.js';
import { runAIQuery } from './ai-core.js';
import sovereignMind from './agents/sovereign/sovereign-mind.js';
import executiveAgent from './agents/sovereign/executive-agent.js';
import qualityGateAgent from './agents/sovereign/quality-gate-agent.js';
import diagnosticAgent from './agents/sovereign/diagnostic-agent.js';
import { checkAndAlert } from './agents/utils/alert-engine.js';
import { startSelfHealer } from './agents/utils/self-healer.js'; startSelfHealer();
import { getRedundancyHealth } from './agents/utils/redundancy-manager.js';
import { runCacheRevalidation } from './agents/utils/gateway-sentinel.js';
import { rateLimitMiddleware } from './agents/utils/rate-limiter.js';
import { auditPerformance } from './agents/utils/performance-scorer.js';
import { runRetention, analyzeTablesAfterCleanup } from './agents/utils/data-retention.js';

dotenv.config();

const { Pool } = pg;

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 64) { console.error('FATAL: ENCRYPTION_KEY missing'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('FATAL: DATABASE_URL missing'); process.exit(1); }

const SECRET_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query('SELECT 1').then(() => logger.info('Database connected')).catch(err => { logger.error('FATAL: DB failed', { error: err.message }); process.exit(1); });

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => { req.correlationId = uuidv4(); res.setHeader('X-Correlation-ID', req.correlationId); next(); });

const THREATS = [/union.*select/i, /drop\s+table/i, /<script/i, /\.\.\//, /sqlmap|nikto/i];
app.use((req, res, next) => {
  const data = JSON.stringify({ q: req.query, b: req.body, p: req.path });
  if (THREATS.some(p => p.test(data))) { logger.warn('THREAT', { ip: req.ip }); return res.status(403).json({ error: 'Blocked' }); }
  next();
});

app.use('/api/', rateLimit({ windowMs: 60000, max: 100 }));
app.use('/api/', slowDown({ windowMs: 60000, delayAfter: 30, delayMs: hits => hits * 200 }));


app.get('/', (req, res) => res.json({ status: 'active', entity: 'ChinaAIF-Sovereign-Mind', version: '1.0.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/api/secure-inject',
  rateLimit({ windowMs: 900000, max: 10 }),
  body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_\-.]+$/),
  body('email').trim().isEmail().normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ error: 'Validation failed', details: errors.array() });
    const { username, email } = req.body;
    try {
      const result = await pool.query(
        'INSERT INTO accounts (username, email) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id',
        [username, encrypt(email)]
      );
      res.status(201).json({ status: 'Created', id: result.rows[0]?.id, correlationId: req.correlationId });
    } catch (err) { logger.error('Inject error', { error: err.message }); res.status(500).json({ error: 'Failed', correlationId: req.correlationId }); }
  }
);

app.get('/api/users', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const [data, count] = await Promise.all([
      pool.query('SELECT id, username, created_at FROM accounts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, (page-1)*limit]),
      pool.query('SELECT COUNT(*) FROM accounts'),
    ]);
    res.json({ data: data.rows, pagination: { page, limit, total: parseInt(count.rows[0].count) }, correlationId: req.correlationId });
  } catch (err) { res.status(500).json({ error: 'Failed', correlationId: req.correlationId }); }
});

app.post('/api/ai/execute', async (req, res) => {
  const { agentId, action, resource, input } = req.body;
  if (!agentId || !action || !resource) return res.status(422).json({ error: 'Missing required fields' });
  try {
    const result = await agentExecute({
      agentId, userId: req.body.userId || null, action, resource, input,
      executeFn: async () => ({ processed: true, data: input, timestamp: new Date().toISOString() })
    });
    res.json({ ...result, correlationId: req.correlationId });
  } catch (err) { logger.error('AI error', { error: err.message }); res.status(500).json({ error: 'AI failed', correlationId: req.correlationId }); }
});

app.get('/api/ai/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  try {
    const result = await pool.query('SELECT * FROM ai_agent_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, (page-1)*limit]);
    res.json({ data: result.rows, correlationId: req.correlationId });
  } catch (err) { res.status(500).json({ error: 'Failed', correlationId: req.correlationId }); }
});

app.get('/api/ai/permissions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ai_permissions ORDER BY role, resource');
    res.json({ data: result.rows, correlationId: req.correlationId });
  } catch (err) { res.status(500).json({ error: 'Failed', correlationId: req.correlationId }); }
});

app.post('/api/ai/chat', async (req, res) => {
  const { messages, resource } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(422).json({ error: 'messages array required' });
  try {
    const result = await runAIQuery({ userId: req.body.userId || null, messages, resource: resource || 'models' });
    res.json({ ...result, correlationId: req.correlationId });
  } catch (err) {
    if (err.message === 'PERMISSION_DENIED') return res.status(403).json({ error: 'PERMISSION_DENIED' });
    logger.error('AI chat error', { error: err.message });
    res.status(500).json({ error: 'AI failed', correlationId: req.correlationId });
  }
});


app.post('/api/brain/think', async (req, res) => {
  const { query, context, priority = 5 } = req.body;
  if (!query) return res.status(422).json({ error: 'query required' });
  try {
    await pool.query('INSERT INTO agent_task_queue (agent_name, task_type, priority, payload, status) VALUES ($1,$2,$3,$4,$5)',
      ['master_orchestrator', 'brain_query', priority, JSON.stringify({ query, context }), 'pending']);
    const memory = await pool.query('SELECT * FROM brain_long_memory WHERE memory_type=$1 ORDER BY importance DESC LIMIT 5', ['strategic']);
    const result = await runAIQuery({ messages: [{ role: 'user', content: query }], resource: 'models' });
    await pool.query('INSERT INTO brain_long_memory (memory_type, key, value, importance) VALUES ($1,$2,$3,$4) ON CONFLICT (memory_type,key) DO UPDATE SET value=$3, updated_at=NOW()',
      ['strategic', query.substring(0,50), JSON.stringify({ query, answer: result.content, timestamp: new Date() }), priority]);
    res.json({ answer: result.content, memory_context: memory.rows, model: result.model, correlationId: req.correlationId });
  } catch(err) { res.status(500).json({ error: err.message, correlationId: req.correlationId }); }
});

app.get('/api/agents/health', async (req, res) => {
  try {
    const [registry, heartbeat, circuit, queue] = await Promise.all([
      pool.query('SELECT agent_layer, COUNT(*) as count, COUNT(CASE WHEN status=$1 THEN 1 END) as active FROM agent_registry GROUP BY agent_layer', ['active']),
      pool.query('SELECT agent_name, status, last_ping, missed_pings FROM agent_heartbeat ORDER BY last_ping DESC LIMIT 20'),
      pool.query('SELECT agent_name, state, failure_count FROM agent_circuit_breaker WHERE state != $1', ['closed']),
      pool.query('SELECT status, COUNT(*) as count FROM agent_task_queue GROUP BY status'),
    ]);
    res.json({ registry: registry.rows, heartbeat: heartbeat.rows, circuit_breakers: circuit.rows, queue_stats: queue.rows, correlationId: req.correlationId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks/queue', async (req, res) => {
  const { agent_name, task_type, priority = 5, payload } = req.body;
  if (!agent_name || !task_type) return res.status(422).json({ error: 'agent_name and task_type required' });
  try {
    const circuit = await pool.query('SELECT state FROM agent_circuit_breaker WHERE agent_name=$1', [agent_name]);
    if (circuit.rows[0]?.state === 'open') return res.status(503).json({ error: 'Agent circuit breaker OPEN — agent temporarily disabled' });
    const result = await pool.query('INSERT INTO agent_task_queue (agent_name, task_type, priority, payload) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
      [agent_name, task_type, Math.min(Math.max(priority,1),10), JSON.stringify(payload)]);
    res.status(201).json({ task_id: result.rows[0].id, status: 'queued', priority, correlationId: req.correlationId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/agents/heartbeat', async (req, res) => {
  const { agent_name, metadata } = req.body;
  if (!agent_name) return res.status(422).json({ error: 'agent_name required' });
  try {
    await pool.query('INSERT INTO agent_heartbeat (agent_name, status, last_ping, metadata) VALUES ($1,$2,NOW(),$3) ON CONFLICT DO NOTHING',
      [agent_name, 'alive', JSON.stringify(metadata)]);
    await pool.query('UPDATE agent_heartbeat SET status=$1, last_ping=NOW(), missed_pings=0, metadata=$2 WHERE agent_name=$3',
      ['alive', JSON.stringify(metadata), agent_name]);
    res.json({ status: 'ok', agent: agent_name, timestamp: new Date().toISOString() });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/brain/memory', async (req, res) => {
  const { type = 'strategic', limit = 20 } = req.query;
  try {
    const result = await pool.query('SELECT * FROM brain_long_memory WHERE memory_type=$1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY importance DESC, updated_at DESC LIMIT $2',
      [type, Math.min(limit,100)]);
    res.json({ memories: result.rows, count: result.rows.length, correlationId: req.correlationId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks/queue', async (req, res) => {
  const { status = 'pending', limit = 50 } = req.query;
  try {
    const result = await pool.query('SELECT * FROM agent_task_queue WHERE status=$1 ORDER BY priority DESC, created_at ASC LIMIT $2', [status, limit]);
    res.json({ tasks: result.rows, count: result.rows.length, correlationId: req.correlationId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.use((err, req, res, next) => { logger.error('Unhandled', { error: err.message }); res.status(500).json({ error: 'Internal Error', correlationId: req.correlationId }); });
// ═══ SOVEREIGN MIND API ═══

app.post('/api/sovereign/think', async (req, res) => {
  try {
    const { input, context } = req.body;
    if(!input) return res.status(400).json({error:'input required'});
    const r = await sovereignMind.think(input, context||{});
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/sovereign/execute', async (req, res) => {
  try {
    const { operation_id, command_type, payload } = req.body;
    if(!command_type||!payload) return res.status(400).json({error:'command_type and payload required'});
    const r = await executiveAgent.prepareCommand(operation_id||null, command_type, payload);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.post('/api/sovereign/review/:commandId', async (req, res) => {
  try {
    const r = await qualityGateAgent.review(req.params.commandId);
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/sovereign/diagnostic', async (req, res) => {
  try {
    const r = await diagnosticAgent.scan();
    res.json(r);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/sovereign/status', async (req, res) => {
  try {
    const [ops, models] = await Promise.all([
      pool.query('SELECT COUNT(*),status FROM sovereign_operations GROUP BY status'),
      pool.query('SELECT COUNT(*) FROM model_registry_sovereign WHERE is_active=true')
    ]);
    res.json({ agents:108, sovereign_operations: ops.rows, active_models: parseInt(models.rows[0].count), status:'operational' });
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/sovereign/dashboard', async (req, res) => {
  try {
    const [health, ops, repairs, models, tasks, logs] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) FROM agent_heartbeat GROUP BY status`),
      pool.query(`SELECT status, COUNT(*) FROM sovereign_operations GROUP BY status ORDER BY status`),
      pool.query(`SELECT issue_severity, COUNT(*) FROM diagnostic_repairs GROUP BY issue_severity`),
      pool.query(`SELECT COUNT(*) FROM model_registry_sovereign WHERE is_active=true`),
      pool.query(`SELECT status, COUNT(*) FROM agent_task_queue GROUP BY status`),
      pool.query(`SELECT agent_name, status, created_at FROM agent_execution_logs ORDER BY created_at DESC LIMIT 5`),
    ]);
    res.json({
      timestamp: new Date(),
      system: {
        agents_total: 108,
        heartbeat: health.rows,
        active_models: parseInt(models.rows[0].count),
      },
      sovereign: { operations: ops.rows },
      diagnostics: { repairs: repairs.rows },
      tasks: { queue: tasks.rows },
      recent_activity: logs.rows,
      status: 'operational'
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});



app.use((req, res) => res.status(404).json({ error: 'Not Found' }));


process.on('SIGTERM', () => { server.close(() => { pool.end(); process.exit(0); }); });

process.on('uncaughtException', err => logger.error('Uncaught', { error: err.message }));

const server = app.listen(process.env.PORT || 5000, "0.0.0.0", () => console.log("✅ Sovereign Kernel Active on port " + (process.env.PORT || 5000)));

// ── Dynamic imports after server start ──
import('./agents/worker-scheduler.js').catch(e => console.error('worker-scheduler error:', e.message));
// worker-scheduler loaded dynamically after server start

// ── Health Check ─────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                        as total_logs,
        COUNT(*) FILTER (WHERE status='completed')      as completed,
        COUNT(*) FILTER (WHERE status='failed')         as failed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour
      FROM agent_execution_logs
    `);
    const stats = rows[0];

    const { rows: agents } = await pool.query(`
      SELECT agent_name, MAX(created_at) as last_seen, COUNT(*) as runs
      FROM agent_execution_logs
      GROUP BY agent_name
      ORDER BY last_seen DESC
      LIMIT 20
    `);

    const alerts = await checkAndAlert();

    res.json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      commit:    'a2937dd',
      db:        'connected',
      stats,
      active_agents: agents.length,
      top_agents:    agents,
      alerts:        alerts.length,
      alert_details: alerts
    });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Judicial Intelligence Dashboard ─────────────────────────────
app.get('/api/judicial/stats', async (req, res) => {
  try {
    const [cache, routing, firewall, distill] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total,
               SUM(usage_count) as total_hits,
               ROUND(AVG(confidence)) as avg_confidence,
               COUNT(*) FILTER (WHERE is_permanent=null OR verified=true) as verified
        FROM sovereign_memory_local
      `),
      pool.query(`
        SELECT decision, COUNT(*) as count,
               ROUND(AVG(latency_ms)) as avg_latency_ms
        FROM judicial_routing_log
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY decision ORDER BY count DESC
      `),
      pool.query(`
        SELECT blocked, COUNT(*) as count,
               threat_type
        FROM security_filter_log
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY blocked, threat_type ORDER BY count DESC
      `),
      pool.query(`
        SELECT COUNT(*) as rules,
               COUNT(*) FILTER (WHERE is_permanent=true) as permanent,
               ROUND(AVG(confidence)) as avg_confidence
        FROM knowledge_distillation
      `)
    ]);

    const cacheHits    = routing.rows.find(r => r.decision === 'cache_hit');
    const totalRouted  = routing.rows.reduce((s, r) => s + parseInt(r.count), 0);
    const hitRate      = totalRouted > 0 && cacheHits
      ? ((parseInt(cacheHits.count) / totalRouted) * 100).toFixed(1)
      : '0.0';

    res.json({
      timestamp: new Date().toISOString(),
      sovereign_memory: {
        ...cache.rows[0],
        cache_hit_rate_24h: `${hitRate}%`
      },
      routing_24h:   routing.rows,
      security_24h:  firewall.rows,
      distillation:  distill.rows[0],
      system_status: 'judicial_layer_active'
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Redundancy Health Endpoint ───────────────────────────────────

app.get('/api/redundancy/health', async (req, res) => {
  try {
    const health = await getRedundancyHealth();
    const critical = health.filter(r => r.circuit_open);
    res.json({
      timestamp:     new Date().toISOString(),
      total_functions: health.length,
      circuits_open:   critical.length,
      critical:        critical,
      all:             health
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Gateway Sentinel + Cache Revalidation ───────────────────────

// Cache revalidation كل ساعتين
setInterval(runCacheRevalidation, 2 * 60 * 60000);
runCacheRevalidation();

app.get('/api/sentinel/status', async (req, res) => {
  try {
    const [memory, blocked] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE valid_until > NOW()) as valid,
               COUNT(*) FILTER (WHERE valid_until < NOW()) as expired,
               ROUND(AVG(confidence)) as avg_confidence
        FROM sovereign_memory_local
      `),
      pool.query(`
        SELECT COUNT(*) as blocked_24h
        FROM security_filter_log
        WHERE blocked=true AND created_at > NOW() - INTERVAL '24 hours'
      `)
    ]);
    res.json({
      timestamp:      new Date().toISOString(),
      hmac_active:    true,
      token_ttl_ms:   5000,
      cache:          memory.rows[0],
      blocked_24h:    blocked.rows[0].blocked_24h,
      sentinel:       'active'
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Infrastructure Layer ─────────────────────────────────────────

// Rate Limiting على كل الـAPI
app.use('/api/', rateLimitMiddleware('api_per_ip'));

// Data Retention كل 24 ساعة
setInterval(async () => {
  await runRetention();
  await analyzeTablesAfterCleanup();
}, 24 * 60 * 60000);

// Performance Audit كل 30 دقيقة
setInterval(auditPerformance, 30 * 60000);

// Endpoints
app.get('/api/performance/scores', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT agent_name, accuracy_score, total_runs, successful_runs,
             failed_runs, avg_latency_ms, avg_confidence, degraded, last_run
      FROM agent_performance_scores
      ORDER BY accuracy_score DESC
    `);
    res.json({ timestamp: new Date().toISOString(), total: rows.length, agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/costs/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        agent_name,
        SUM(tokens_in + tokens_out) as total_tokens,
        SUM(cost_usd)               as total_cost_usd,
        COUNT(*) FILTER (WHERE cache_saved=true) as cache_hits,
        COUNT(*)                    as total_calls
      FROM cost_tracking
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY agent_name
      ORDER BY total_cost_usd DESC
      LIMIT 20
    `);
    res.json({ timestamp: new Date().toISOString(), period: '24h', agents: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
