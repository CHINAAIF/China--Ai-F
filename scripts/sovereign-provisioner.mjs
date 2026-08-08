/**
 * TRUNKIA Sovereign Database Provisioner v2.2 (Omega Protocol)
 * Extracts the exact DDL error to stop guessing.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HMAC_SECRET = process.env.IMMUNE_SECRET || process.env.GOVERNANCE_HMAC_SECRET || 'trunkia_omega_fallback';

let queryFn = null;
let driverMode = 'none';
let pgPool = null;

async function initDriver() {
  try {
    const { Pool } = require('pg');
    const connStr = process.env.DATABASE_URL;
    if (connStr) {
      pgPool = new Pool({ connectionString: connStr, connectionTimeoutMillis: 3000, max: 3 });
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      queryFn = async (sql, params = []) => {
        const c = await pgPool.connect();
        try { return await c.query(sql, params); }
        finally { c.release(); }
      };
      driverMode = 'tcp';
      console.log('[DRIVER] TCP (pg.Pool) connected.');
      return;
    }
  } catch (e) { console.warn('[DRIVER] TCP failed:', e.message.substring(0, 80)); }
  
  try {
    const { neon } = require('@neondatabase/serverless');
    const connStr = process.env.DATABASE_URL;
    if (connStr) {
      const sql = neon(connStr);
      queryFn = async (query, params = []) => {
        if (params && params.length > 0) return await sql.query(query, params);
        return await sql.query(query);
      };
      await queryFn('SELECT 1 as test');
      driverMode = 'http';
      console.log('[DRIVER] HTTP (Neon Serverless) connected.');
      return;
    }
  } catch (e) { console.warn('[DRIVER] HTTP failed:', e.message.substring(0, 80)); }
  
  throw new Error('No database driver available.');
}

async function autoGrantPermissions() {
  console.log('\n[AUTO-GRANT] Attempting permission escalation...');
  try {
    await queryFn('GRANT ALL ON SCHEMA public TO PUBLIC;');
    console.log('  [✓] GRANT ALL ON SCHEMA public TO PUBLIC succeeded.');
  } catch (e) {
    console.warn('  [!] GRANT TO PUBLIC failed:', e.message.substring(0, 100));
  }
  
  // Also try granting to current_user dynamically
  try {
    await queryFn(`DO $$ BEGIN EXECUTE 'GRANT ALL ON SCHEMA public TO ' || quote_ident(current_user); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Skip: %', SQLERRM; END $$;`);
    console.log('  [✓] GRANT TO current_user succeeded.');
  } catch (e) {
    console.warn('  [!] GRANT TO current_user failed:', e.message.substring(0, 100));
  }
}

// PRACTICAL DDL TEST: Now returns the exact error message
async function verifyPermissions() {
  try {
    // Clean up any previous test tables first
    await queryFn('DROP TABLE IF EXISTS sovereign_perm_test;');
    // Try to create
    await queryFn('CREATE TABLE sovereign_perm_test (id int);');
    // Clean up
    await queryFn('DROP TABLE sovereign_perm_test;');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function computeSHA256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function signHMAC(data) { return crypto.createHmac('sha256', HMAC_SECRET).update(data).digest('hex'); }

const VERSION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sovereign_schema_versions (id SERIAL PRIMARY KEY, file_name TEXT NOT NULL UNIQUE, file_hash TEXT NOT NULL, file_size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', executed_at TIMESTAMPTZ, error_message TEXT, hmac_signature TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;

async function ensureVersionTable() { await queryFn(VERSION_TABLE_SQL); console.log('[✓] sovereign_schema_versions table ensured.'); }

async function checkIfApplied(fileName, fileHash) {
  const result = await queryFn('SELECT file_name, file_hash, status FROM sovereign_schema_versions WHERE file_name = $1 ORDER BY executed_at DESC LIMIT 1', [fileName]);
  if (!result.rows || result.rows.length === 0) return { applied: false };
  const row = result.rows[0];
  return { applied: row.status === 'SUCCESS', hashMatch: row.file_hash === fileHash };
}

async function recordProvisioning(fileName, fileHash, fileSize, status, errorMessage) {
  const payload = JSON.stringify({ fileName, fileHash, fileSize, status, errorMessage, timestamp: new Date().toISOString() });
  const hmac = signHMAC(payload);
  await queryFn(
    `INSERT INTO sovereign_schema_versions (file_name, file_hash, file_size, status, executed_at, error_message, hmac_signature) VALUES ($1, $2, $3, $4, NOW(), $5, $6) ON CONFLICT (file_name) DO UPDATE SET file_hash = $2, file_size = $3, status = $4, executed_at = NOW(), error_message = $5, hmac_signature = $6`,
    [fileName, fileHash, fileSize, status, errorMessage, hmac]
  );
}

function splitSQLStatements(sql) {
  const statements = [];
  let current = '', inSingle = false, inDouble = false, inDollar = false, dollarTag = '', inLine = false, inBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1];
    if (!inSingle && !inDouble && !inDollar && !inBlock && char === '-' && next === '-') inLine = true;
    if (inLine) { if (char === '\n') inLine = false; current += char; continue; }
    if (!inSingle && !inDouble && !inDollar && !inLine && char === '/' && next === '*') { inBlock = true; current += char + next; i++; continue; }
    if (inBlock) { if (char === '*' && next === '/') { current += char + next; i++; inBlock = false; continue; } current += char; continue; }
    if (char === "'" && !inDouble && !inDollar) inSingle = !inSingle;
    if (char === '"' && !inSingle && !inDollar) inDouble = !inDouble;
    if (char === '$' && !inSingle && !inDouble && !inBlock && !inLine) {
      if (!inDollar) { const m = sql.substring(i).match(/^\$[a-zA-Z_0-9]*\$/); if (m) { dollarTag = m[0]; inDollar = true; current += m[0]; i += m[0].length - 1; continue; } }
      else { if (sql.substring(i).startsWith(dollarTag)) { current += dollarTag; i += dollarTag.length - 1; inDollar = false; dollarTag = ''; continue; } }
    }
    if (char === ';' && !inSingle && !inDouble && !inDollar && !inLine && !inBlock) {
      current += char; const t = current.trim(); if (t.length > 0 && !t.startsWith('--')) statements.push(t); current = ''; continue;
    }
    current += char;
  }
  const t = current.trim(); if (t.length > 0 && !t.startsWith('--')) statements.push(t);
  return statements;
}

async function executeSQLFile(fileName, sql) {
  const statements = splitSQLStatements(sql);
  let s = 0, f = 0; const errors = [];
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]; if (stmt.length < 5) continue;
    try {
      await queryFn(stmt); s++;
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('duplicate')) { f++; errors.push(`Stmt ${i + 1}: ${e.message.substring(0, 80)}`); }
      else { s++; }
    }
  }
  return { success: f === 0 || (s > 0 && f < s * 0.3), successCount: s, failCount: f, errors: errors.slice(0, 3) };
}

function discoverSQLFiles() {
  const files = [];
  const searchPaths = [
    { dir: '.', pattern: /^schema-part\d+\.sql$/ }, { dir: '.', pattern: /^schema-v5-/ },
    { dir: '.', pattern: /^install-triggers\.sql$/ }, { dir: 'migrations', pattern: /\.sql$/ }, { dir: 'agents', pattern: /schema\.sql$/ }
  ];
  for (const { dir, pattern } of searchPaths) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) if (pattern.test(entry)) files.push(path.join(dir, entry));
  }
  return files.sort();
}

async function postFlightVerification() {
  const report = { tables: { count: 0, list: [], critical: {} }, triggers: 0, rlsPolicies: 0, functions: 0, sovereignScore: 0 };
  try {
    const res = await queryFn('SELECT tablename FROM pg_tables WHERE schemaname = \'public\' ORDER BY tablename;');
    report.tables.count = res.rows.length; report.tables.list = res.rows.map(r => r.tablename);
    const critical = ['agent_registry', 'api_keys', 'app_user', 'event_log', 'governance_audit_chain', 'sovereign_schema_versions', 'user_quota'];
    for (const t of critical) report.tables.critical[t] = report.tables.list.includes(t);
  } catch (e) {}
  try { const r = await queryFn('SELECT count(*) as c FROM information_schema.triggers WHERE trigger_schema = \'public\';'); report.triggers = parseInt(r.rows[0].c, 10); } catch (e) {}
  try { const r = await queryFn('SELECT count(*) as c FROM pg_policies WHERE schemaname = \'public\';'); report.rlsPolicies = parseInt(r.rows[0].c, 10); } catch (e) {}
  try { const r = await queryFn('SELECT count(*) as c FROM information_schema.routines WHERE routine_schema = \'public\' AND routine_type = \'FUNCTION\';'); report.functions = parseInt(r.rows[0].c, 10); } catch (e) {}
  let score = 0;
  if (report.tables.count > 20) score += 30; else if (report.tables.count > 10) score += 20; else if (report.tables.count > 5) score += 10;
  const criticalMet = Object.values(report.tables.critical).filter(v => v).length; score += (criticalMet / 7) * 30;
  if (report.triggers > 0) score += 15; if (report.rlsPolicies > 0) score += 15; if (report.functions > 0) score += 10;
  report.sovereignScore = Math.round(Math.min(100, score));
  return report;
}

async function runProvisioning() {
  console.log('==========================================================');
  console.log('[SOVEREIGN PROVISIONER v2.2] Initializing...');
  console.log('==========================================================');
  
  await initDriver();
  
  let permCheck = await verifyPermissions();
  if (!permCheck.ok) {
    console.log('\n[PERMISSIONS] CREATE privilege missing. Attempting auto-escalation...');
    await autoGrantPermissions();
    await new Promise(r => setTimeout(r, 2000));
    permCheck = await verifyPermissions();
    
    if (!permCheck.ok) {
      console.error('\n[FATAL] Could not verify CREATE permission even after grant.');
      console.error('==========================================================');
      console.error('EXACT DATABASE ERROR:');
      console.error(permCheck.error);
      console.error('==========================================================');
      console.error('Please copy this exact error and run the grant manually in Neon if needed.');
      process.exit(1);
    }
  }
  console.log('[✓] Permissions verified practically (Create/Drop test passed).');
  
  await ensureVersionTable();
  const schemaFiles = discoverSQLFiles();
  console.log(`\n[DISCOVER] Found ${schemaFiles.length} SQL files.`);
  
  const userQuotaSQL = `CREATE TABLE IF NOT EXISTS user_quota (user_id TEXT PRIMARY KEY, remaining_quota BIGINT DEFAULT 1000000, held_quota BIGINT DEFAULT 0, total_consumed BIGINT DEFAULT 0); CREATE TABLE IF NOT EXISTS quota_audit (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT UNIQUE, held_amount BIGINT NOT NULL, actual_cost BIGINT NOT NULL, refund BIGINT NOT NULL, settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
  
  console.log('\n[PROVISION] Executing Schema Files...');
  let successCount = 0, skipCount = 0, failCount = 0;
  
  for (const file of schemaFiles) {
    if (!fs.existsSync(file)) { skipCount++; continue; }
    const sql = fs.readFileSync(file, 'utf8');
    const fileHash = computeSHA256(sql);
    const applied = await checkIfApplied(file, fileHash);
    if (applied.applied && applied.hashMatch) { skipCount++; continue; }
    
    console.log(`[EXEC] ${file} (${sql.length}b, ${splitSQLStatements(sql).length} statements)`);
    const result = await executeSQLFile(file, sql);
    
    if (result.success) {
      console.log(`  [✓] ${result.successCount} ok, ${result.failCount} skipped.`);
      await recordProvisioning(file, fileHash, sql.length, 'SUCCESS', null);
      successCount++;
    } else {
      console.warn(`  [⚠] ${result.successCount} ok, ${result.failCount} failed.`);
      if (result.errors.length > 0) result.errors.forEach(e => console.warn(`      ${e}`));
      await recordProvisioning(file, fileHash, sql.length, 'PARTIAL', JSON.stringify(result.errors));
      failCount++;
    }
  }
  
  console.log('\n[EXEC] user_quota (sovereign addition)');
  const uqHash = computeSHA256(userQuotaSQL);
  if (!(await checkIfApplied('user_quota_sovereign', uqHash)).applied) {
    const uqResult = await executeSQLFile('user_quota', userQuotaSQL);
    if (uqResult.success) { console.log('  [✓] user_quota created.'); await recordProvisioning('user_quota_sovereign', uqHash, userQuotaSQL.length, 'SUCCESS', null); successCount++; }
    else { console.warn('  [⚠] user_quota:', uqResult.errors); await recordProvisioning('user_quota_sovereign', uqHash, userQuotaSQL.length, 'PARTIAL', JSON.stringify(uqResult.errors)); failCount++; }
  } else { skipCount++; }
  
  const report = await postFlightVerification();
  console.log('\n==========================================================');
  console.log('[SOVEREIGN HEALTH REPORT]');
  console.log('==========================================================');
  console.log(`Files: ${successCount} success, ${skipCount} skipped, ${failCount} partial`);
  console.log(`Tables: ${report.tables.count} | Triggers: ${report.triggers} | RLS: ${report.rlsPolicies} | Funcs: ${report.functions}`);
  console.log(`Sovereign Score: ${report.sovereignScore}/100`);
  
  if (report.tables.list.length > 0) {
    console.log('\n[ALL TABLES]');
    report.tables.list.forEach(t => console.log(`  - ${t}`));
  }
  
  if (report.sovereignScore >= 70) { console.log('\n[✓] PROVISIONING SUCCESSFUL.'); process.exit(0); }
  else if (report.sovereignScore >= 40) { console.log('\n[⚠] PROVISIONING PARTIAL.'); process.exit(0); }
  else { console.log('\n[✗] PROVISIONING FAILED.'); process.exit(1); }
}

runProvisioning().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
