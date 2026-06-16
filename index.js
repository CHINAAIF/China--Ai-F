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

app.use((err, req, res, next) => { logger.error('Unhandled', { error: err.message }); res.status(500).json({ error: 'Internal Error', correlationId: req.correlationId }); });
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));


process.on('SIGTERM', () => { server.close(() => { pool.end(); process.exit(0); }); });
process.on('uncaughtException', err => logger.error('Uncaught', { error: err.message }));
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    logger.info(`Sovereign Kernel Active on port ${PORT}`);
});
