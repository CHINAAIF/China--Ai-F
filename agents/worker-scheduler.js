import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── جدول الأولويات ──────────────────────────────────────────────
const SCHEDULE = [
  // [agent_path, interval_ms, priority]
  ['./service/market-data-agent.js',        5  * 60000, 1],
  ['./service/news-aggregator-agent.js',    5  * 60000, 1],
  ['./service/currency-agent.js',           5  * 60000, 1],
  ['./analysis/trend-analysis-agent.js',   10  * 60000, 2],
  ['./analysis/sentiment-agent.js',        10  * 60000, 2],
  ['./analysis/risk-assessment-agent.js',  15  * 60000, 2],
  ['./learning/pattern-learner-agent.js',  20  * 60000, 3],
  ['./learning/feedback-agent.js',         30  * 60000, 3],
];

const timers   = new Map();
const stats    = new Map();
let   deadCount   = 0;
let   failedCount = 0;

// ── تشغيل وكيل واحد بأمان ───────────────────────────────────────
async function runAgent(agentPath, priority) {
  const key = agentPath;
  if (!stats.has(key)) stats.set(key, { runs: 0, fails: 0, last: null });
  const s = stats.get(key);

  try {
    const mod = await import(agentPath);
    const agent = mod.default || Object.values(mod)[0];
    if (!agent) throw new Error('no_export');

    const result = await agent.run({});
    s.runs++;
    s.last = new Date().toISOString();

    if (!result?.success) {
      s.fails++;
      failedCount++;
      await logDiagnostic(agentPath, 'failed', result?.error || 'unknown');
    }

    await pool.query(
      `INSERT INTO agent_execution_logs
         (agent_name, action, input, output, confidence, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        agentPath.split('/').pop().replace('.js',''),
        'scheduled_run',
        JSON.stringify({ priority }),
        JSON.stringify(result?.data || {}),
        75,
        result?.success ? 'completed' : 'failed'
      ]
    ).catch(() => {});

  } catch(e) {
    s.fails++;
    failedCount++;
    await logDiagnostic(agentPath, 'crash', e.message);
  }
}

// ── تسجيل في diagnostic_repairs ─────────────────────────────────
async function logDiagnostic(agentPath, type, msg) {
  try {
    await pool.query(
      `INSERT INTO diagnostic_repairs
         (component, issue_type, description, auto_repaired, created_at)
       VALUES ($1,$2,$3,$4,NOW())`,
      [agentPath.split('/').pop(), type, msg, false]
    );
  } catch(_) {}
}

// ── Alert: dead>5 أو failed>20 ──────────────────────────────────
async function checkAlerts() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM agent_execution_logs
       WHERE status='failed' AND created_at > NOW() - INTERVAL '1 hour'`
    );
    const recentFails = parseInt(rows[0].cnt);

    if (recentFails > 20 || deadCount > 5) {
      await pool.query(
        `INSERT INTO diagnostic_repairs
           (component, issue_type, description, auto_repaired, created_at)
         VALUES ($1,$2,$3,$4,NOW())`,
        [
          'worker-scheduler',
          'alert',
          `ALERT: recentFails=${recentFails} deadCount=${deadCount}`,
          false
        ]
      );
      console.error(`🚨 ALERT: fails=${recentFails} dead=${deadCount}`);
    }
  } catch(_) {}
}

// ── تهيئة الجداول إن غابت ───────────────────────────────────────
async function ensureTables() {
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public'
         AND table_name IN ('diagnostic_repairs','agent_execution_logs')`
    );
    const found = rows.map(r => r.table_name);

    if (!found.includes('diagnostic_repairs')) {
      await pool.query(`
        CREATE TABLE diagnostic_repairs (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          component     VARCHAR NOT NULL,
          issue_type    VARCHAR NOT NULL,
          description   TEXT,
          auto_repaired BOOLEAN DEFAULT false,
          created_at    TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('✅ diagnostic_repairs created');
    }
  } catch(e) {
    console.warn('ensureTables:', e.message);
  }
}

// ── بدء الجدولة ─────────────────────────────────────────────────
async function start() {
  await ensureTables();
  console.log('🔄 Worker Scheduler starting —', SCHEDULE.length, 'agents');

  for (const [path, interval, priority] of SCHEDULE) {
    // تشغيل فوري أول مرة
    runAgent(path, priority);

    const t = setInterval(() => runAgent(path, priority), interval);
    timers.set(path, t);
  }

  // فحص alerts كل 5 دقائق
  setInterval(checkAlerts, 5 * 60000);

  // طباعة إحصائيات كل 10 دقائق
  setInterval(() => {
    console.log('📊 Worker stats:');
    for (const [k, v] of stats) {
      console.log(` ${k.split('/').pop()}: runs=${v.runs} fails=${v.fails} last=${v.last}`);
    }
  }, 10 * 60000);
}

start();
