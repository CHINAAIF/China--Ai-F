import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// ── ضمان وجود المجلدات قبل أي شيء ──────────────────────────────
const dirs = ['scripts','agents/sovereign','agents/utils','agents/governance'];
for (const d of dirs) {
  try {
    if (!existsSync(`/app/${d}`))
      await mkdir(`/app/${d}`, { recursive: true });
  } catch(_) {}
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

const TABLES = [
  {
    name: 'sovereign_memory_local',
    ddl: `CREATE TABLE sovereign_memory_local (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      query_hash    VARCHAR(64) NOT NULL UNIQUE,
      query_text    TEXT NOT NULL,
      response_data JSONB NOT NULL,
      model_used    VARCHAR(100),
      confidence    SMALLINT CHECK (confidence BETWEEN 0 AND 100),
      usage_count   INTEGER DEFAULT 1,
      last_used     TIMESTAMP DEFAULT NOW(),
      verified      BOOLEAN DEFAULT false,
      created_at    TIMESTAMP DEFAULT NOW()
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_sml_hash ON sovereign_memory_local(query_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_sml_conf ON sovereign_memory_local(confidence DESC)`
    ]
  },
  {
    name: 'judicial_routing_log',
    ddl: `CREATE TABLE judicial_routing_log (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_name     VARCHAR NOT NULL,
      query_hash     VARCHAR(64),
      decision       VARCHAR(50) NOT NULL,
      model_selected VARCHAR(100),
      cache_hit      BOOLEAN DEFAULT false,
      tokens_saved   INTEGER DEFAULT 0,
      cost_usd       NUMERIC(10,6) DEFAULT 0,
      latency_ms     INTEGER,
      created_at     TIMESTAMP DEFAULT NOW()
    )`,
    indexes: []
  },
  {
    name: 'security_filter_log',
    ddl: `CREATE TABLE security_filter_log (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_agent VARCHAR NOT NULL,
      content_hash VARCHAR(64),
      threat_type  VARCHAR(100),
      threat_score SMALLINT CHECK (threat_score BETWEEN 0 AND 100),
      blocked      BOOLEAN DEFAULT false,
      raw_preview  TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    )`,
    indexes: []
  },
  {
    name: 'knowledge_distillation',
    ddl: `CREATE TABLE knowledge_distillation (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_hash     VARCHAR(64) NOT NULL UNIQUE,
      rule_text     TEXT NOT NULL,
      source_agent  VARCHAR NOT NULL,
      confidence    SMALLINT CHECK (confidence BETWEEN 0 AND 100),
      applied_count INTEGER DEFAULT 0,
      is_permanent  BOOLEAN DEFAULT false,
      created_at    TIMESTAMP DEFAULT NOW()
    )`,
    indexes: []
  }
];

async function migrate() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    `);
    const existing = rows.map(r => r.table_name);

    for (const t of TABLES) {
      try {
        if (existing.includes(t.name)) {
          console.log(`⏭️  ${t.name} exists`);
          continue;
        }
        await client.query(t.ddl);
        for (const idx of t.indexes) {
          try { await client.query(idx); } catch(_) {}
        }
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t.name)) throw new Error('اسم جدول غير صالح: ' + t.name);
        const { rows: verify } = await client.query(`SELECT COUNT(*) FROM ${t.name}`);
        console.log(`✅ ${t.name} created — rows: ${verify[0].count}`);
      } catch(e) {
        console.error(`❌ ${t.name}: ${e.message}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
