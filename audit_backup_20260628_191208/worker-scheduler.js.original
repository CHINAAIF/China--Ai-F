import { config } from 'dotenv';
config();
import { pool } from './utils/db.js';

// ── جدول الأولويات — مسارات مؤكَّدة الوجود فعلياً ──────────────
const SCHEDULE = [
  // [agent_path, interval_ms, priority]
  ['./intelligence/china_investment_agent.js',   5  * 60000, 1],
  ['./intelligence/global_models_agent.js',      5  * 60000, 1],
  ['./intelligence/china_company_agent.js',      5  * 60000, 1],
  ['./analysis/trend_prediction_agent.js',      10  * 60000, 2],
  ['./analysis/sentiment_analysis_agent.js',    10  * 60000, 2],
  ['./analysis/model-benchmarking-engine.js',   30  * 60000, 2],
  ['./learning/learning_agent.js',              20  * 60000, 3],
  ['./learning/approval_agent.js',              30  * 60000, 3],
];

const stats = new Map();

// ── تشغيل وكيل واحد بأمان ───────────────────────────────────────
async function runAgent(agentPath, priority) {
  const key = agentPath;
  if (!stats.has(key)) stats.set(key, { runs: 0, fails: 0, last: null });
  const s = stats.get(key);
  const agentName = agentPath.split('/').pop().replace('.js', '');

  try {
    const mod = await import(agentPath);
    const agent = mod.default || Object.values(mod)[0];
    if (!agent || typeof agent.run !== 'function') {
      throw new Error('no_run_export');
    }

    const result = await agent.run({});
    s.runs++;
    s.last = new Date().toISOString();

    if (!result?.success) {
      s.fails++;
      await logDiagnostic(agentName, 'failed', result?.error || 'unknown');
    }

    await pool.query(
      `INSERT INTO agent_execution_logs
         (agent_name, action, input, output, confidence, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        agentName,
        'scheduled_run',
        JSON.stringify({ priority }),
        JSON.stringify(result?.data || {}),
        75,
        result?.success ? 'completed' : 'failed'
      ]
    ).catch(e => console.warn('⚠️ log_fail:', e.message));

  } catch(e) {
    s.fails++;
    await logDiagnostic(agentName, 'crash', e.message);
    console.error(`❌ ${agentName}: ${e.message}`);
  }
}

// ── consumer حقيقي لـagent_task_queue ───────────────────────────
async function processQueue() {
  try {
    // اسحب مهمة pending بالأولوية + قفل لتجنب التعارض
    const { rows } = await pool.query(`
      UPDATE agent_task_queue
      SET status='running', started_at=NOW(), attempts=attempts+1
      WHERE id = (
        SELECT id FROM agent_task_queue
        WHERE status='pending'
          AND (scheduled_at IS NULL OR scheduled_at <= NOW())
          AND attempts < max_attempts
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    if (!rows.length) return; // لا مهام

    const task = rows[0];
    const agentName = task.agent_name;

      // قائمة سوداء للملفات standalone التي تغلق pool المشترك
      const STANDALONE = ['china-news-agent','pricing-tracker-agent','verification-agent','china-social','china_news_agent','pricing_tracker_agent'];
      if (STANDALONE.includes(agentName)) {
        console.log(`⏭️ skip standalone: ${agentName}`);
        await pool.query(`UPDATE agent_task_queue SET status='failed', error_log=COALESCE(error_log,'')||'standalone_agent_not_importable' WHERE id=$1`, [task.id]);
        return;
      }

    const payload   = task.payload || {};

    console.log(`📋 task: ${agentName}/${task.task_type} id=${task.id}`);

    try {
      // حاول تحميل الوكيل من registry
      let result = null;

      // مسارات البحث بالترتيب
      const searchPaths = [
        `./governance/${agentName}.js`,
        `./intelligence/${agentName}.js`,
        `./analysis/${agentName}.js`,
        `./learning/${agentName}.js`,
        `./service/${agentName}.js`,
        `./security/${agentName}.js`,
        `./sovereign/${agentName.replace('_','-')}.js`,
      ];

      let agent = null;
      for (const p of searchPaths) {
        try {
          const mod = await import(p);
          const candidate = mod.default || Object.values(mod)[0];
          if (candidate && typeof candidate.run === 'function') {
            agent = candidate;
            break;
          }
        } catch(_) { /* تابع */ }
      }

      if (agent) {
        result = await agent.run(payload);
      } else {
        // fallback: safeGroqJSON مباشرة للـbrain_query
        if (task.task_type === 'brain_query' && payload.query) {
          const { safeGroqJSON } = await import('./utils/safe-json.js');
          const r = await safeGroqJSON(
            payload.query,
            null,
            agentName
          );
          result = { success: !!r.data, data: r.data, error: r.error };
        } else {
          throw new Error(`agent_not_found: ${agentName}`);
        }
      }

      // حدّث الحالة
      await pool.query(`
        UPDATE agent_task_queue
        SET status='completed',
            completed_at=NOW(),
            result=$1
        WHERE id=$2
      `, [JSON.stringify(result || {}), task.id]);

      console.log(`✅ task completed: ${agentName}/${task.task_type}`);

    } catch(e) {
      // فشل — أعد للـpending أو علّم failed
      const isFinal = task.attempts >= task.max_attempts;
      await pool.query(`
        UPDATE agent_task_queue
        SET status=$1,
            error_log=COALESCE(error_log,'')||$2
        WHERE id=$3
      `, [
        isFinal ? 'failed' : 'pending',
        `\n[${new Date().toISOString()}] ${e.message}`,
        task.id
      ]);
      console.error(`❌ task ${isFinal?'failed':'retry'}: ${agentName} — ${e.message}`);
    }
  } catch(e) {
    console.error('❌ processQueue:', e.message);
  }
}

// ── تسجيل في diagnostic_repairs ─────────────────────────────────
async function logDiagnostic(agentName, type, msg) {
  try {
    await pool.query(`
      INSERT INTO diagnostic_repairs
        (component, issue_type, description, auto_repaired, created_at)
      VALUES ($1,$2,$3,$4,NOW())
    `, [agentName, type, msg, false]);
  } catch(_) {}
}

// ── Alert: failed>20 في ساعة ────────────────────────────────────
async function checkAlerts() {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as cnt FROM agent_execution_logs
      WHERE status='failed' AND created_at > NOW() - INTERVAL '1 hour'
    `);
    const recentFails = parseInt(rows[0].cnt);
    if (recentFails > 20) {
      await logDiagnostic('worker-scheduler', 'alert',
        `ALERT: recentFails=${recentFails}`);
      console.error(`🚨 ALERT: recent_fails=${recentFails}`);
    }
  } catch(_) {}
}

// ── بدء الجدولة ─────────────────────────────────────────────────
async function start() {
  console.log('🔄 Worker Scheduler starting —', SCHEDULE.length, 'agents');

  for (const [agentPath, interval, priority] of SCHEDULE) {
    // تشغيل فوري أول مرة
    runAgent(agentPath, priority).catch(() => {});
    setInterval(() => runAgent(agentPath, priority).catch(() => {}), interval);
  }

  // queue consumer — كل 10 ثوانٍ
  setInterval(() => processQueue().catch(() => {}), 10000);
  processQueue().catch(() => {}); // تشغيل فوري

  // alerts كل 5 دقائق
  setInterval(checkAlerts, 5 * 60000);

  // إحصاءات كل 10 دقائق
  setInterval(() => {
    console.log('📊 Worker stats:');
    for (const [k, v] of stats) {
      console.log(` ${k.split('/').pop()}: runs=${v.runs} fails=${v.fails} last=${v.last}`);
    }
  }, 10 * 60000);
}

start();
