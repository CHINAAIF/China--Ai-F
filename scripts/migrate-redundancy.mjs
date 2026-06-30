import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

const client = await pool.connect();

try {
  // ── فحص الجداول الموجودة أولاً ─────────────────────────
  const { rows: existing } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
  `);
  const tables = existing.map(r => r.table_name);

  // ── فحص الأعمدة الموجودة في sovereign_memory_local ─────
  const { rows: cols } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sovereign_memory_local'
  `);
  const existingCols = cols.map(r => r.column_name);

  // ── إضافة أعمدة TTL وConfidence Decay ──────────────────
  if (!existingCols.includes('valid_until')) {
    await client.query(`
      ALTER TABLE sovereign_memory_local
      ADD COLUMN valid_until TIMESTAMP DEFAULT (NOW() + INTERVAL '48 hours')
    `);
    console.log('✅ valid_until added');
  }

  if (!existingCols.includes('decay_rate')) {
    await client.query(`
      ALTER TABLE sovereign_memory_local
      ADD COLUMN decay_rate SMALLINT DEFAULT 5 CHECK (decay_rate BETWEEN 1 AND 20)
    `);
    console.log('✅ decay_rate added');
  }

  if (!existingCols.includes('revalidated_at')) {
    await client.query(`
      ALTER TABLE sovereign_memory_local
      ADD COLUMN revalidated_at TIMESTAMP
    `);
    console.log('✅ revalidated_at added');
  }

  // ── جدول تسجيل الوكلاء والـRedundancy ──────────────────
  if (!tables.includes('agent_redundancy_map')) {
    await client.query(`
      CREATE TABLE agent_redundancy_map (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        function_key VARCHAR(100) NOT NULL UNIQUE,
        primary_agent   VARCHAR(200) NOT NULL,
        secondary_agent VARCHAR(200) NOT NULL,
        tertiary_agent  VARCHAR(200),
        active_agent    VARCHAR(200),
        failure_count   SMALLINT DEFAULT 0,
        circuit_open    BOOLEAN DEFAULT false,
        last_failure    TIMESTAMP,
        last_success    TIMESTAMP,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX idx_arm_function ON agent_redundancy_map(function_key)
    `);
    console.log('✅ agent_redundancy_map created');

    // ── حقن خريطة الوكلاء الحيويين ─────────────────────
    const map = [
      ['web_scraping',    'intelligence/china-news-agent.js',     'intelligence/china-social.js',         'intelligence/china_media_agent.js'],
      ['verification',    'governance/verification-agent.js',      'analysis/truth_verifier_agent.js',     'analysis/fact_checker_agent.js'],
      ['pricing',         'intelligence/pricing-tracker-agent.js', 'analysis/price_prediction_agent.js',   'service/dynamic_pricing_agent.js'],
      ['threat_security', 'security/threat_monitor_agent.js',      'security/fraud_detection_agent.js',    'security/cyber_defense_agent.js'],
      ['db_guardian',     'service/db_guardian_agent.js',          'service/db_updater_agent.js',          'service/backup_agent.js'],
      ['market_intel',    'intelligence/china_investment_agent.js','intelligence/china_company_agent.js',  'intelligence/global_comparison_agent.js'],
      ['content_write',   'content/content_writer_agent.js',       'content/editorial_agent.js',           'content/summary_agent.js'],
      ['analysis_trend',  'analysis/trend_prediction_agent.js',    'analysis/sentiment_analysis_agent.js', 'analysis/benchmark_analyst_agent.js'],
      ['policy_intel',    'intelligence/china_policy_agent.js',    'intelligence/china_research_agent.js', 'intelligence/china_sanctions_agent.js'],
      ['performance',     'service/platform_health_agent.js',      'service/api_monitor_agent.js',         'service/performance_agent.js'],
    ];

    for (const [key, primary, secondary, tertiary] of map) {
      try {
        await client.query(`
          INSERT INTO agent_redundancy_map
            (function_key, primary_agent, secondary_agent, tertiary_agent, active_agent)
          VALUES ($1,$2,$3,$4,$2)
        `, [key, primary, secondary, tertiary]);
        console.log(`✅ mapped: ${key}`);
      } catch(e) {
        console.warn(`⚠️  map failed ${key}: ${e.message}`);
      }
    }
  } else {
    console.log('⏭️  agent_redundancy_map exists');
  }

  // ── جدول سجل Circuit Breaker ────────────────────────────
  if (!tables.includes('circuit_breaker_log')) {
    await client.query(`
      CREATE TABLE circuit_breaker_log (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        function_key VARCHAR(100) NOT NULL,
        failed_agent VARCHAR(200) NOT NULL,
        fallback_agent VARCHAR(200),
        failure_reason TEXT,
        circuit_opened BOOLEAN DEFAULT false,
        recovered_at   TIMESTAMP,
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ circuit_breaker_log created');
  }

  // ── تحقق نهائي ──────────────────────────────────────────
  const { rows: verify } = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM agent_redundancy_map) as redundancy_maps,
      (SELECT COUNT(*) FROM circuit_breaker_log)  as circuit_logs,
      (SELECT COUNT(*) FROM sovereign_memory_local) as memory_entries
  `);
  console.log('\n✅ Verification:', verify[0]);

} catch(e) {
  console.error('❌ Migration error:', e.message);
} finally {
  client.release();
  await pool.end();
}
