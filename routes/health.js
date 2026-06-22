
import express from 'express';
import pg from 'pg';
import crypto from 'crypto';
const router = express.Router();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

// ── Request ID middleware ────────────────────────────────────────
router.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

router.get('/', async (req, res) => {
  try {
    const {rows} = await pool.query('SELECT COUNT(*) FROM agent_execution_logs');
    res.json({
      status: 'ok',
      version: 'v1',
      request_id: req.requestId,
      timestamp: new Date().toISOString(),
      total_logs: rows[0].count
    });
  } catch(e) { res.status(500).json({ error: e.message, request_id: req.requestId }); }
});

router.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now(), request_id: req.requestId }));

export default router;
