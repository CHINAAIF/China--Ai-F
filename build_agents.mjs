import { config } from 'dotenv'; config();
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import pg from 'pg';
import { createHash } from 'crypto';

console.log('🚀 بدء البناء...');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});
await client.connect();
console.log('✅ DB متصل');

// Migrations
const migrations = [
  `ALTER TABLE entities ADD COLUMN IF NOT EXISTS entity_identity_hash VARCHAR UNIQUE, ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1, ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE temporal_intelligence ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1`,
  `ALTER TABLE model_timeline ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1`,
  `ALTER TABLE evidence_chain ADD COLUMN IF NOT EXISTS chain_hash VARCHAR, ADD COLUMN IF NOT EXISTS previous_hash VARCHAR`,
  `CREATE INDEX IF NOT EXISTS idx_entities_hash ON entities(entity_identity_hash)`
];

for (const sql of migrations) {
  try { await client.query(sql); console.log('✅ migration OK'); }
  catch(e) { console.log('⚠️', e.message.split('\n')[0]); }
}

await client.end();
console.log('✅ Migrations done');
