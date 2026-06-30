import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

const client = await pool.connect();

try {
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public'
  `);
  const tables = rows.map(r => r.table_name);

  // ── 1. Data Retention — partitioning بديل لـNeon ────────
  // إضافة index على created_at لتسريع الحذف
  const { rows: idx } = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='agent_execution_logs'
    AND indexname='idx_ael_created_at'
  `);
  if (idx.length === 0) {
    await client.query(`
      CREATE INDEX idx_ael_created_at ON agent_execution_logs(created_at DESC)
    `);
    console.log('✅ idx_ael_created_at created');
  }

  // index على status + created_at للـalert queries
  const { rows: idx2 } = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename='agent_execution_logs'
    AND indexname='idx_ael_status_created'
  `);
  if (idx2.length === 0) {
    await client.query(`
      CREATE INDEX idx_ael_status_created
      ON agent_execution_logs(status, created_at DESC)
    `);
    console.log('✅ idx_ael_status_created created');
  }

  // ── 2. جدول Rate Limiter ─────────────────────────────────
  if (!tables.includes('rate_limit_buckets')) {
    await client.query(`
      CREATE TABLE rate_limit_buckets (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_key   VARCHAR(200) NOT NULL UNIQUE,
        requests     INTEGER DEFAULT 0,
        window_start TIMESTAMP DEFAULT NOW(),
        blocked_until TIMESTAMP,
        total_blocked INTEGER DEFAULT 0,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX idx_rlb_key ON rate_limit_buckets(bucket_key)
    `);
    console.log('✅ rate_limit_buckets created');
  }

  // ── 3. جدول Agent Performance Scoring ───────────────────
  if (!tables.includes('agent_performance_scores')) {
    await client.query(`
      CREATE TABLE agent_performance_scores (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_name      VARCHAR(200) NOT NULL UNIQUE,
        total_runs      INTEGER DEFAULT 0,
        successful_runs INTEGER DEFAULT 0,
        failed_runs     INTEGER DEFAULT 0,
        avg_latency_ms  INTEGER DEFAULT 0,
        avg_confidence  SMALLINT DEFAULT 0,
        accuracy_score  SMALLINT DEFAULT 100 CHECK (accuracy_score BETWEEN 0 AND 100),
        cost_tokens     INTEGER DEFAULT 0,
        last_run        TIMESTAMP,
        degraded        BOOLEAN DEFAULT false,
        updated_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX idx_aps_score ON agent_performance_scores(accuracy_score DESC)
    `);
    console.log('✅ agent_performance_scores created');
  }

  // ── 4. جدول Webhook Notifications ───────────────────────
  if (!tables.includes('webhook_queue')) {
    await client.query(`
      CREATE TABLE webhook_queue (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type  VARCHAR(100) NOT NULL,
        payload     JSONB NOT NULL,
        sent        BOOLEAN DEFAULT false,
        attempts    SMALLINT DEFAULT 0,
        error       TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        sent_at     TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX idx_wq_sent ON webhook_queue(sent, created_at DESC)
    `);
    console.log('✅ webhook_queue created');
  }

  // ── 5. جدول Cost Tracking ────────────────────────────────
  if (!tables.includes('cost_tracking')) {
    await client.query(`
      CREATE TABLE cost_tracking (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_name   VARCHAR(200) NOT NULL,
        model_used   VARCHAR(100) NOT NULL,
        tokens_in    INTEGER DEFAULT 0,
        tokens_out   INTEGER DEFAULT 0,
        cost_usd     NUMERIC(10,8) DEFAULT 0,
        cache_saved  BOOLEAN DEFAULT false,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX idx_ct_agent ON cost_tracking(agent_name, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX idx_ct_created ON cost_tracking(created_at DESC)
    `);
    console.log('✅ cost_tracking created');
  }

  // ── تحقق نهائي ──────────────────────────────────────────
  const { rows: verify } = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM rate_limit_buckets)      as rate_buckets,
      (SELECT COUNT(*) FROM agent_performance_scores) as perf_scores,
      (SELECT COUNT(*) FROM webhook_queue)            as webhook_queue,
      (SELECT COUNT(*) FROM cost_tracking)            as cost_tracking
  `);
  console.log('\n✅ Verification:', verify[0]);

} catch(e) {
  console.error('❌ Migration error:', e.message);
} finally {
  client.release();
  await pool.end();
}
