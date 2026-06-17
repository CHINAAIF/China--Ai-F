import dotenv from 'dotenv';
dotenv.config();
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
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));


process.on('SIGTERM', () => { server.close(() => { pool.end(); process.exit(0); }); });

// ═══ SOVEREIGN MIND API ═══
import sovereignMind from './agents/sovereign/sovereign-mind.js';
import executiveAgent from './agents/sovereign/executive-agent.js';
import qualityGateAgent from './agents/sovereign/quality-gate-agent.js';
import diagnosticAgent from './agents/sovereign/diagnostic-agent.js';

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

process.on('uncaughtException', err => logger.error('Uncaught', { error: err.message }));

const server = app.listen(process.env.PORT || 5000, "0.0.0.0", () => console.log("✅ Sovereign Kernel Active on port " + (process.env.PORT || 5000)));
