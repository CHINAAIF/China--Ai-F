#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const KNOWN_SENSITIVE_TABLES = [
  'evidence_chain', 'immune_audit_chain', 'intel_provenance_chain', 'provenance_log',
  'governance_contracts', 'governance_decisions', 'governance_audit_chain', 'routing_decisions',
  'judicial_routing_log', 'schema_change_log', 'security_events', 'security_incidents',
  'audit_logs', 'security_filter_log', 'canary_tokens', 'canary_trigger_events',
  'api_keys', 'byok_keys', 'sovereign_key_infrastructure', 'users', 'sessions',
  'certificates', 'continuous_trust_sessions'
];

const HIGH_RISK_KEYWORDS = [
  'chain', 'evidence', 'audit', 'governance', 'security', 'provenance', 'intel',
  'immune', 'policy', 'threat', 'zero_trust', 'canary', 'key', 'token', 'secret',
  'certificate', 'trust', 'session', 'user', 'credential'
];

const SENSITIVE_COLUMN_KEYWORDS = [
  'password', 'token', 'secret', 'key', 'hmac', 'signature',
  'hash', 'credential', 'private', 'api_key', 'auth'
];

const WEIGHTS = { hasHashChainColumns: 40, tableNameSensitive: 25, hasSensitiveColumns: 20, foreignKeyToSensitive: 10, highRowCount: 5 };

async function hasHashChainColumns(t) {
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND (column_name LIKE '%hash%' OR column_name LIKE '%chain%' OR column_name LIKE '%hmac%' OR column_name LIKE '%signature%' OR column_name LIKE '%previous%')`, [t]);
  return r.rows.length > 0;
}

function isTableNameSensitive(t) {
  const l = t.toLowerCase();
  return HIGH_RISK_KEYWORDS.some(kw => l.includes(kw));
}

async function hasSensitiveColumns(t) {
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t]);
  return r.rows.some(c => SENSITIVE_COLUMN_KEYWORDS.some(kw => c.column_name.toLowerCase().includes(kw)));
}

// إصلاح: استعلام موثوق للمفاتيح الخارجية عبر pg_constraint مباشرة بدل information_schema الهش
async function hasForeignKeyToSensitive(t) {
  const r = await pool.query(`
    SELECT confrelid::regclass::text AS foreign_table
    FROM pg_constraint
    WHERE conrelid = $1::regclass AND contype = 'f'
  `, [t]);
  return r.rows.some(row => KNOWN_SENSITIVE_TABLES.includes(row.foreign_table));
}

async function getRowCount(t) {
  try {
    const r = await pool.query(`SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname=$1`, [t]);
    return r.rows.length > 0 ? parseInt(r.rows[0].estimate) : 0;
  } catch { return 0; }
}

async function calculateSensitivityScore(t) {
  let score = 0; const reasons = [];
  if (await hasHashChainColumns(t)) { score += WEIGHTS.hasHashChainColumns; reasons.push('hash/chain/hmac columns'); }
  if (isTableNameSensitive(t)) { score += WEIGHTS.tableNameSensitive; reasons.push('sensitive name keyword'); }
  if (await hasSensitiveColumns(t)) { score += WEIGHTS.hasSensitiveColumns; reasons.push('sensitive column names'); }
  if (await hasForeignKeyToSensitive(t)) { score += WEIGHTS.foreignKeyToSensitive; reasons.push('FK to sensitive table'); }
  const rc = await getRowCount(t);
  if (rc > 10000) { score += WEIGHTS.highRowCount; reasons.push(`high row count (${rc})`); }
  let level = 'Low';
  if (score >= 70) level = 'Critical'; else if (score >= 50) level = 'High'; else if (score >= 30) level = 'Medium';
  return { score: Math.min(score, 100), level, reasons: reasons.length ? reasons : ['general table'] };
}

async function run() {
  console.log('=== DISCOVERY (fixed v2) ===\n');
  const all = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  const results = [];
  for (const row of all.rows) {
    const a = await calculateSensitivityScore(row.table_name);
    if (a.score > 0) results.push({ table: row.table_name, ...a });
  }
  results.sort((a, b) => b.score - a.score);

  // الربط الحقيقي: كتابة النتائج فعلياً إلى governance_protection_registry
  for (const item of results) {
    await pool.query(`
      INSERT INTO governance_protection_registry (table_name, risk_level, status, notes)
      VALUES ($1, $2, 'pending_review', $3)
      ON CONFLICT (table_name) DO UPDATE
      SET risk_level = EXCLUDED.risk_level, notes = EXCLUDED.notes, updated_at = NOW()
    `, [item.table, item.level, item.reasons.join('; ')]);
  }

  const c = results.filter(r => r.level === 'Critical').length;
  const h = results.filter(r => r.level === 'High').length;
  const m = results.filter(r => r.level === 'Medium').length;
  console.log(`Total: ${results.length} | Critical: ${c} | High: ${h} | Medium: ${m}`);
  console.log('✅ Results written to governance_protection_registry');
  await pool.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
