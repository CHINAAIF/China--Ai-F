import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── بصمة فريدة لكل instance ──────────────────────────────────────
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');
const STARTUP_KEY = `startup_lock:${process.env.RAILWAY_SERVICE_ID || 'local'}`;

// ── جدول الـPipelines بأولوياتها وتأخيراتها ─────────────────────
const PIPELINE_SCHEDULE = [
  // [name, delay_ms, priority] — تدرج زمني يمنع الـthunder herd
  { name: 'core-intelligence',    delay:      0, priority: 1 },
  { name: 'service-pipeline',     delay:  30000, priority: 2 },
  { name: 'security-pipeline',    delay:  60000, priority: 2 },
  { name: 'analysis-pipeline',    delay:  90000, priority: 3 },
  { name: 'intelligence-pipeline',delay: 120000, priority: 3 },
  { name: 'learning-pipeline',    delay: 150000, priority: 4 },
  { name: 'content-pipeline',     delay: 180000, priority: 5 },
];

// ── تسجيل الـinstance في DB ──────────────────────────────────────
async function registerInstance() {
  try {
    const { rows: exists } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name='startup_registry'
    `);

    if (exists.length === 0) {
      await pool.query(`
        CREATE TABLE startup_registry (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          instance_id   VARCHAR(32) NOT NULL UNIQUE,
          service_id    VARCHAR(200),
          started_at    TIMESTAMP DEFAULT NOW(),
          last_heartbeat TIMESTAMP DEFAULT NOW(),
          pipelines_ready BOOLEAN DEFAULT false,
          status        VARCHAR(50) DEFAULT 'starting'
        )
      `);
      await pool.query(`
        CREATE INDEX idx_sr_instance ON startup_registry(instance_id)
      `);
    }

    await pool.query(`
      INSERT INTO startup_registry
        (instance_id, service_id, status)
      VALUES ($1,$2,'starting')
      ON CONFLICT (instance_id) DO UPDATE SET
        started_at = NOW(),
        last_heartbeat = NOW(),
        status = 'starting'
    `, [INSTANCE_ID, process.env.RAILWAY_SERVICE_ID || 'local']);

    console.log(`🆔 Instance registered: ${INSTANCE_ID}`);
    return true;
  } catch(e) {
    console.warn('registerInstance:', e.message);
    return false;
  }
}

// ── فحص هل يوجد instance آخر يعمل ──────────────────────────────
async function isAnotherInstanceActive() {
  try {
    const { rows } = await pool.query(`
      SELECT instance_id FROM startup_registry
      WHERE instance_id != $1
        AND last_heartbeat > NOW() - INTERVAL '30 seconds'
        AND status = 'ready'
      LIMIT 1
    `, [INSTANCE_ID]);
    return rows.length > 0;
  } catch(_) { return false; }
}

// ── Heartbeat للـinstance الحالي ─────────────────────────────────
function startInstanceHeartbeat() {
  setInterval(async () => {
    try {
      await pool.query(`
        UPDATE startup_registry
        SET last_heartbeat = NOW()
        WHERE instance_id = $1
      `, [INSTANCE_ID]);
    } catch(_) {}
  }, 10000); // كل 10 ثوانٍ
}

// ── تنظيف الـinstances الميتة ────────────────────────────────────
async function cleanDeadInstances() {
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM startup_registry
      WHERE last_heartbeat < NOW() - INTERVAL '2 minutes'
        AND instance_id != $1
    `, [INSTANCE_ID]);
    if (rowCount > 0) console.log(`🗑️  Cleaned ${rowCount} dead instances`);
  } catch(_) {}
}

// ── Jitter لمنع thundering herd بين instances متزامنة ───────────
function calculateJitter(baseDelay, pipelinePriority) {
  const instanceHash = parseInt(INSTANCE_ID.slice(0,4), 16);
  const jitter = (instanceHash % 10000); // 0-10000ms jitter
  const priorityDelay = (pipelinePriority - 1) * 5000;
  return baseDelay + jitter + priorityDelay;
}

// ── تشغيل pipeline بأمان مع تأخير محسوب ─────────────────────────
async function schedulePipeline(pipeline, runFn) {
  const delay = calculateJitter(pipeline.delay, pipeline.priority);

  setTimeout(async () => {
    try {
      console.log(`⏱️  [${pipeline.name}] starting after ${delay}ms delay`);
      await runFn(pipeline.name);

      await pool.query(`
        INSERT INTO diagnostic_repairs
          (component, issue_type, description, auto_repaired, created_at)
        VALUES ($1,'pipeline_started',$2,true,NOW())
      `, [pipeline.name, `instance=${INSTANCE_ID} delay=${delay}ms`]).catch(()=>{});

    } catch(e) {
      console.error(`❌ Pipeline [${pipeline.name}] failed to start: ${e.message}`);
      await pool.query(`
        INSERT INTO diagnostic_repairs
          (component, issue_type, description, auto_repaired, created_at)
        VALUES ($1,'pipeline_start_failed',$2,false,NOW())
      `, [pipeline.name, e.message]).catch(()=>{});
    }
  }, delay);
}

// ── الدالة الرئيسية ──────────────────────────────────────────────
export async function coordinateStartup(pipelineRunner) {
  console.log(`\n🚀 Startup Coordinator — Instance: ${INSTANCE_ID}`);

  // 1. تسجيل الـinstance
  await registerInstance();

  // 2. تنظيف الميتين
  await cleanDeadInstances();

  // 3. فحص instance آخر نشط
  const anotherActive = await isAnotherInstanceActive();
  if (anotherActive) {
    console.log('⚡ Another instance is active — running in standby mode');
    // في الـstandby: نشغل الـheartbeat فقط ولا نشغل الـpipelines
    startInstanceHeartbeat();
    return;
  }

  // 4. جدولة الـpipelines بتأخير متدرج
  console.log(`📅 Scheduling ${PIPELINE_SCHEDULE.length} pipelines with staggered delays...`);
  for (const pipeline of PIPELINE_SCHEDULE) {
    await schedulePipeline(pipeline, pipelineRunner);
  }

  // 5. تحديث الـstatus
  setTimeout(async () => {
    try {
      await pool.query(`
        UPDATE startup_registry
        SET status='ready', pipelines_ready=true
        WHERE instance_id=$1
      `, [INSTANCE_ID]);
      console.log(`✅ Instance ${INSTANCE_ID} — all pipelines scheduled`);
    } catch(_) {}
  }, 5000);

  // 6. تشغيل الـheartbeat
  startInstanceHeartbeat();

  // 7. تنظيف دوري كل دقيقة
  setInterval(cleanDeadInstances, 60000);
}

export { INSTANCE_ID, PIPELINE_SCHEDULE };
export default { coordinateStartup, INSTANCE_ID };
