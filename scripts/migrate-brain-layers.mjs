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

  // ── 1. طبقات العقل الأربع ────────────────────────────────
  if (!tables.includes('brain_working_memory')) {
    await client.query(`
      CREATE TABLE brain_working_memory (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_hash    VARCHAR(64) NOT NULL UNIQUE,
        topic           VARCHAR(200) NOT NULL,
        domain          VARCHAR(100) NOT NULL,
        content         JSONB NOT NULL,
        source_url      TEXT,
        source_reputation SMALLINT DEFAULT 50 CHECK (source_reputation BETWEEN 0 AND 100),
        confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100),
        quarantine      BOOLEAN DEFAULT true,
        quarantine_until TIMESTAMP DEFAULT (NOW() + INTERVAL '48 hours'),
        verified_by     TEXT[],
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX idx_bwm_hash ON brain_working_memory(content_hash)`);
    await client.query(`CREATE INDEX idx_bwm_quarantine ON brain_working_memory(quarantine, quarantine_until)`);
    console.log('✅ brain_working_memory created');
  }

  if (!tables.includes('brain_filtered_memory')) {
    await client.query(`
      CREATE TABLE brain_filtered_memory (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_hash    VARCHAR(64) NOT NULL UNIQUE,
        topic           VARCHAR(200) NOT NULL,
        domain          VARCHAR(100) NOT NULL,
        content         JSONB NOT NULL,
        confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100),
        source_count    SMALLINT DEFAULT 1,
        usage_count     INTEGER DEFAULT 0,
        last_used       TIMESTAMP DEFAULT NOW(),
        expires_at      TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days'),
        decay_rate      SMALLINT DEFAULT 3,
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX idx_bfm_domain ON brain_filtered_memory(domain, confidence DESC)`);
    await client.query(`CREATE INDEX idx_bfm_expires ON brain_filtered_memory(expires_at)`);
    console.log('✅ brain_filtered_memory created');
  }

  if (!tables.includes('brain_hard_memory')) {
    await client.query(`
      CREATE TABLE brain_hard_memory (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_hash    VARCHAR(64) NOT NULL UNIQUE,
        rule_text       TEXT NOT NULL,
        domain          VARCHAR(100) NOT NULL,
        confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100),
        verification_count SMALLINT DEFAULT 1,
        source_diversity   SMALLINT DEFAULT 1,
        applied_count   INTEGER DEFAULT 0,
        last_validated  TIMESTAMP DEFAULT NOW(),
        is_global       BOOLEAN DEFAULT false,
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX idx_bhm_domain ON brain_hard_memory(domain, confidence DESC)`);
    console.log('✅ brain_hard_memory created');
  }

  if (!tables.includes('brain_sovereign_memory')) {
    await client.query(`
      CREATE TABLE brain_sovereign_memory (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_hash    VARCHAR(64) NOT NULL UNIQUE,
        decision_text   TEXT NOT NULL,
        domain          VARCHAR(100) NOT NULL,
        confidence      SMALLINT CHECK (confidence BETWEEN 0 AND 100),
        consensus_models TEXT[],
        ground_truth_verified BOOLEAN DEFAULT false,
        hmac_signature  VARCHAR(128),
        immutable       BOOLEAN DEFAULT true,
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ brain_sovereign_memory created');
  }

  // ── 2. جدول تعارضات المعرفة ──────────────────────────────
  if (!tables.includes('knowledge_conflicts')) {
    await client.query(`
      CREATE TABLE knowledge_conflicts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        existing_hash   VARCHAR(64) NOT NULL,
        challenger_hash VARCHAR(64) NOT NULL,
        domain          VARCHAR(100),
        conflict_type   VARCHAR(100),
        resolution      VARCHAR(50) DEFAULT 'pending',
        resolved_by     VARCHAR(200),
        created_at      TIMESTAMP DEFAULT NOW(),
        resolved_at     TIMESTAMP
      )
    `);
    console.log('✅ knowledge_conflicts created');
  }

  // ── 3. جدول فجوات العقل — ماذا لا يعرف ─────────────────
  if (!tables.includes('brain_knowledge_gaps')) {
    await client.query(`
      CREATE TABLE brain_knowledge_gaps (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        topic           VARCHAR(200) NOT NULL,
        domain          VARCHAR(100) NOT NULL,
        priority        SMALLINT DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
        last_searched   TIMESTAMP,
        search_count    SMALLINT DEFAULT 0,
        filled          BOOLEAN DEFAULT false,
        created_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX idx_bkg_priority ON brain_knowledge_gaps(priority DESC, filled)`);
    console.log('✅ brain_knowledge_gaps created');

    // حقن فجوات أولية عالمية
    const gaps = [
      ['AI model pricing global',      'pricing',      10],
      ['China AI regulations 2025',    'policy',       10],
      ['Global LLM benchmarks',        'analysis',      9],
      ['Supply chain disruptions',     'intelligence',  9],
      ['Semiconductor market prices',  'pricing',       8],
      ['AI startup funding rounds',    'intelligence',  8],
      ['China tech company earnings',  'financial',     8],
      ['Global AI safety standards',   'policy',        7],
    ];
    for (const [topic, domain, priority] of gaps) {
      await client.query(`
        INSERT INTO brain_knowledge_gaps (topic, domain, priority)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
      `, [topic, domain, priority]).catch(()=>{});
    }
    console.log('✅ Initial knowledge gaps injected');
  }

  // ── 4. جدول سمعة المصادر ─────────────────────────────────
  if (!tables.includes('source_reputation')) {
    await client.query(`
      CREATE TABLE source_reputation (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        domain_url      VARCHAR(300) NOT NULL UNIQUE,
        reputation_score SMALLINT DEFAULT 50 CHECK (reputation_score BETWEEN 0 AND 100),
        category        VARCHAR(100),
        verified        BOOLEAN DEFAULT false,
        total_citations INTEGER DEFAULT 0,
        accurate_citations INTEGER DEFAULT 0,
        blacklisted     BOOLEAN DEFAULT false,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX idx_sr_domain ON source_reputation(domain_url)`);
    await client.query(`CREATE INDEX idx_sr_score ON source_reputation(reputation_score DESC)`);

    // مصادر موثوقة أولية
    const sources = [
      ['reuters.com',         95, 'news',       true],
      ['bloomberg.com',       93, 'financial',  true],
      ['ft.com',              92, 'financial',  true],
      ['scmp.com',            88, 'china_news', true],
      ['arxiv.org',           90, 'research',   true],
      ['techcrunch.com',      80, 'tech_news',  true],
      ['wsj.com',             91, 'financial',  true],
      ['economist.com',       89, 'analysis',   true],
    ];
    for (const [url, score, cat, verified] of sources) {
      await client.query(`
        INSERT INTO source_reputation (domain_url, reputation_score, category, verified)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
      `, [url, score, cat, verified]).catch(()=>{});
    }
    console.log('✅ Source reputation seeded');
  }

  // ── تحقق نهائي ──────────────────────────────────────────
  const { rows: v } = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM brain_working_memory)   as working,
      (SELECT COUNT(*) FROM brain_filtered_memory)  as filtered,
      (SELECT COUNT(*) FROM brain_hard_memory)      as hard,
      (SELECT COUNT(*) FROM brain_sovereign_memory) as sovereign,
      (SELECT COUNT(*) FROM brain_knowledge_gaps)   as gaps,
      (SELECT COUNT(*) FROM source_reputation)      as sources
  `);
  console.log('\n✅ Brain layers verified:', v[0]);

} catch(e) {
  console.error('❌ Migration error:', e.message);
} finally {
  client.release();
  await pool.end();
}
