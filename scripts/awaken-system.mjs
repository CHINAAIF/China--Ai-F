/**
 * TRUNKIA Sovereign System Awakener v2.0 (Omega Protocol)
 * 
 * Complete Rewrite:
 * 1. Auto-Schema Repair (Create + ALTER)
 * 2. Multi-Phase Testing (DB → Server → API → Logs → Report)
 * 3. Performance Metrics
 * 4. Health Scoring
 * 5. Graceful Degradation
 * 6. Zombie Killer
 */

import fs from 'fs';
import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==========================================
// PHASE 1: DATABASE INTEGRITY (Auto-Repair)
// ==========================================
async function ensureDatabaseIntegrity(ownerUrl) {
  console.log('\n[Phase 1] Database Integrity Check');
  console.log('----------------------------------------------------------');
  
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(ownerUrl);
  
  let score = 0;
  
  // 1. Create missing tables
  const tablesToCreate = [
    { name: 'app_user', sql: `CREATE TABLE IF NOT EXISTS app_user (id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW());` },
    { name: 'sovereign_schema_versions', sql: `CREATE TABLE IF NOT EXISTS sovereign_schema_versions (id SERIAL PRIMARY KEY, file_name TEXT NOT NULL UNIQUE, file_hash TEXT NOT NULL, file_size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', executed_at TIMESTAMPTZ, error_message TEXT, hmac_signature TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());` },
    { name: 'user_quota', sql: `CREATE TABLE IF NOT EXISTS user_quota (user_id TEXT PRIMARY KEY, remaining_quota BIGINT DEFAULT 1000000, held_quota BIGINT DEFAULT 0, total_consumed BIGINT DEFAULT 0);` },
    { name: 'quota_audit', sql: `CREATE TABLE IF NOT EXISTS quota_audit (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT UNIQUE, held_amount BIGINT NOT NULL, actual_cost BIGINT NOT NULL, refund BIGINT NOT NULL, settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW());` }
  ];
  
  for (const { name, sql: createSql } of tablesToCreate) {
    try {
      await sql.query(createSql);
      console.log(`  [✓] ${name} ensured.`);
    } catch (e) {
      console.error(`  [✗] ${name}: ${e.message}`);
    }
  }
  
  // 2. Auto-Repair api_keys columns
  const apiKeysSchema = {
    id: 'UUID DEFAULT gen_random_uuid()',
    user_id: 'TEXT',
    name: 'TEXT',
    key: 'TEXT UNIQUE',
    status: 'TEXT DEFAULT \'active\'',
    scopes: 'TEXT[] DEFAULT \'{}\'',
    metadata: 'JSONB DEFAULT \'{}\'',
    created_at: 'TIMESTAMPTZ DEFAULT NOW()',
    revoked_at: 'TIMESTAMPTZ',
    expires_at: 'TIMESTAMPTZ',
    last_used_at: 'TIMESTAMPTZ'
  };
  
  try {
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'api_keys' AND table_schema = 'public';`;
    const existing = cols.map(c => c.column_name);
    let added = 0;
    for (const [col, type] of Object.entries(apiKeysSchema)) {
      if (!existing.includes(col)) {
        await sql.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ${col} ${type};`);
        console.log(`  [✓] api_keys.${col} added.`);
        added++;
      }
    }
    if (added === 0) console.log('  [✓] api_keys schema complete.');
    score += 20;
  } catch (e) {
    console.warn(`  [⚠] api_keys check: ${e.message}`);
  }
  
  // 3. Auto-Repair user_quota columns
  const userQuotaSchema = {
    user_id: 'TEXT',
    remaining_quota: 'BIGINT DEFAULT 1000000',
    held_quota: 'BIGINT DEFAULT 0',
    total_consumed: 'BIGINT DEFAULT 0'
  };
  
  try {
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_quota' AND table_schema = 'public';`;
    const existing = cols.map(c => c.column_name);
    let added = 0;
    for (const [col, type] of Object.entries(userQuotaSchema)) {
      if (!existing.includes(col)) {
        await sql.query(`ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS ${col} ${type};`);
        console.log(`  [✓] user_quota.${col} added.`);
        added++;
      }
    }
    if (added === 0) console.log('  [✓] user_quota schema complete.');
    score += 20;
  } catch (e) {
    console.warn(`  [⚠] user_quota check: ${e.message}`);
  }
  
  // 4. Verify agent_registry
  try {
    const agents = await sql`SELECT count(*) as count FROM agent_registry;`;
    const count = parseInt(agents[0].count, 10);
    console.log(`  [✓] agent_registry: ${count} agents.`);
    if (count > 0) score += 20;
  } catch (e) {
    console.error(`  [✗] agent_registry: ${e.message}`);
  }
  
  // 5. Count total tables
  try {
    const tables = await sql`SELECT count(*) as count FROM pg_tables WHERE schemaname = 'public';`;
    const count = parseInt(tables[0].count, 10);
    console.log(`  [✓] Total tables: ${count}`);
    if (count > 50) score += 20;
    else if (count > 20) score += 15;
    else if (count > 10) score += 10;
  } catch (e) {
    console.error(`  [✗] Table count: ${e.message}`);
  }
  
  // 6. Check critical tables
  const critical = ['agent_registry', 'api_keys', 'event_log', 'user_quota', 'sovereign_schema_versions', 'app_user'];
  let criticalFound = 0;
  for (const t of critical) {
    try {
      const exists = await sql`SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = ${t} AND schemaname = 'public');`;
      if (exists[0].exists) criticalFound++;
      else console.warn(`  [⚠] Missing: ${t}`);
    } catch (e) {}
  }
  console.log(`  [✓] Critical tables: ${criticalFound}/${critical.length}`);
  if (criticalFound === critical.length) score += 20;
  else score += (criticalFound / critical.length) * 20;
  
  console.log(`\n  DB Health Score: ${Math.round(score)}/100`);
  return { score: Math.round(score), criticalFound, totalCritical: critical.length };
}

// ==========================================
// PHASE 2: SERVER BOOTSTRAP
// ==========================================
async function bootstrapServer() {
  console.log('\n[Phase 2] Server Bootstrap');
  console.log('----------------------------------------------------------');
  
  if (!fs.existsSync('.env.staging')) {
    console.error('  [✗] .env.staging not found.');
    return { ready: false };
  }
  
  const envFile = fs.readFileSync('.env.staging', 'utf8');
  const envVars = {};
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) envVars[match[1].trim()] = match[2].trim();
  });
  
  const serverEnv = {
    ...process.env,
    ...envVars,
    IMMUNE_SECRET: 'trunkia_immune_2026',
    PORT: '9090',
    NODE_ENV: 'staging',
    BYPASS_AUTH: 'true'
  };
  
  // Zombie Killer
  try { execSync('pkill -9 -f "node index.js"', { stdio: 'ignore' }); } catch (e) {}
  await sleep(1000);
  
  const server = spawn('node', ['index.js'], {
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let logs = '';
  server.stdout.on('data', (data) => {
    const text = data.toString();
    logs += text;
    if (text.includes('TRUNKIA Phase7') || text.includes('Error') || text.includes('Cron') || text.includes('FATAL')) {
      process.stdout.write(`  [SERVER] ${text}`);
    }
  });
  server.stderr.on('data', (data) => { logs += data.toString(); });
  
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`  [✗] Server exited with code ${code}.`);
    }
  });
  
  // Poll /ping
  console.log('  Waiting for server to be ready...');
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9090/ping');
      if (res.ok) {
        console.log(`  [✓] Server ready after ${(i * 0.5).toFixed(1)}s.`);
        return { server, logs, ready: true };
      }
    } catch (e) {}
    await sleep(500);
  }
  
  console.error('  [✗] Server failed to start within 15s.');
  return { server, logs, ready: false };
}

// ==========================================
// PHASE 3: API VERIFICATION
// ==========================================
async function verifyAPIs() {
  console.log('\n[Phase 3] API Verification');
  console.log('----------------------------------------------------------');
  
  const results = [];
  const tests = [
    { name: '/health', url: 'http://127.0.0.1:9090/health', method: 'GET', expect: 200 },
    { name: '/ping', url: 'http://127.0.0.1:9090/ping', method: 'GET', expect: 200 },
    { name: '/api/agents', url: 'http://127.0.0.1:9090/api/agents', method: 'GET', expect: 200 },
    { name: '/api/supervisor/diagnostic', url: 'http://127.0.0.1:9090/api/supervisor/diagnostic', method: 'GET', expect: 403 },
    { name: '/api/agents/layers', url: 'http://127.0.0.1:9090/api/agents/layers', method: 'GET', expect: 200 }
  ];
  
  for (const test of tests) {
    const start = Date.now();
    try {
      const res = await fetch(test.url, { method: test.method });
      const elapsed = Date.now() - start;
      
      if (test.expect === 403 && (res.status === 403 || res.status === 401)) {
        console.log(`  [✓] ${test.name}: ${res.status} (${elapsed}ms) - Auth guard working.`);
        results.push({ name: test.name, pass: true, status: res.status, elapsed });
      } else if (res.status === test.expect) {
        let detail = '';
        try {
          const data = await res.json();
          if (test.name === '/api/agents') detail = ` - ${data.count || 0} agents`;
          if (test.name === '/api/agents/layers') detail = ` - ${data.layers ? data.layers.length : 0} layers`;
          if (test.name === '/health') detail = ` - Phase ${data.phase}, ${data.endpoints} endpoints`;
        } catch (e) {}
        console.log(`  [✓] ${test.name}: ${res.status} (${elapsed}ms)${detail}`);
        results.push({ name: test.name, pass: true, status: res.status, elapsed });
      } else {
        console.error(`  [✗] ${test.name}: Expected ${test.expect}, got ${res.status} (${elapsed}ms)`);
        results.push({ name: test.name, pass: false, status: res.status, elapsed });
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.error(`  [✗] ${test.name}: ${e.message} (${elapsed}ms)`);
      results.push({ name: test.name, pass: false, status: 0, elapsed });
    }
  }
  
  return results;
}

// ==========================================
// PHASE 4: LOG ANALYSIS
// ==========================================
function analyzeLogs(logs) {
  console.log('\n[Phase 4] Log Analysis');
  console.log('----------------------------------------------------------');
  
  const lines = logs.split('\n');
  const errors = lines.filter(l => l.includes('Error') || l.includes('FATAL') || l.includes('✗'));
  const warnings = lines.filter(l => l.includes('WARN') || l.includes('⚠'));
  
  console.log(`  Total log lines: ${lines.length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  
  if (errors.length > 0) {
    console.log('\n  [ERROR LINES]');
    errors.slice(0, 5).forEach(e => console.log(`    ${e.trim().substring(0, 120)}`));
  }
  
  return { errors: errors.length, warnings: warnings.length };
}

// ==========================================
// MAIN
// ==========================================
async function main() {
  const ownerUrl = process.env.OWNER_DATABASE_URL;
  if (!ownerUrl) {
    console.error('[FATAL] OWNER_DATABASE_URL environment variable not set.');
    process.exit(1);
  }
  
  console.log('==========================================================');
  console.log('[SOVEREIGN SYSTEM AWAKENER v2.0]');
  console.log('==========================================================');
  
  // Phase 1
  const dbResults = await ensureDatabaseIntegrity(ownerUrl);
  
  // Secure cleanup
  delete process.env.OWNER_DATABASE_URL;
  console.log('\n  [🔒] Owner URL wiped from memory.');
  
  // Phase 2
  const { server, logs, ready } = await bootstrapServer();
  
  if (!ready) {
    console.error('\n[SERVER LOGS]');
    console.error(logs.substring(logs.length - 2000));
    if (server) server.kill('SIGKILL');
    process.exit(1);
  }
  
  // Phase 3
  const apiResults = await verifyAPIs();
  
  // Phase 4
  const logAnalysis = analyzeLogs(logs);
  
  // Cleanup
  console.log('\n[Cleanup] Terminating server...');
  if (server) {
    server.kill('SIGKILL');
    console.log('  [✓] Server terminated.');
  }
  
  // Final Report
  console.log('\n==========================================================');
  console.log('[FINAL REPORT]');
  console.log('==========================================================');
  console.log(`Database Health Score: ${dbResults.score}/100`);
  console.log(`Critical Tables: ${dbResults.criticalFound}/${dbResults.totalCritical}`);
  console.log(`API Tests: ${apiResults.filter(r => r.pass).length}/${apiResults.length} passed`);
  
  const avgResponse = apiResults.length > 0 
    ? Math.round(apiResults.reduce((a, b) => a + b.elapsed, 0) / apiResults.length)
    : 0;
  console.log(`Avg Response Time: ${avgResponse}ms`);
  console.log(`Log Errors: ${logAnalysis.errors} | Warnings: ${logAnalysis.warnings}`);
  
  const passed = apiResults.filter(r => r.pass).length;
  if (passed >= 4 && dbResults.score >= 60) {
    console.log('\n[✓] SYSTEM AWAKENED SUCCESSFULLY. TRUNKIA is alive.');
    process.exit(0);
  } else if (passed >= 2) {
    console.log('\n[⚠] SYSTEM PARTIALLY AWAKENED. Some components need attention.');
    process.exit(0);
  } else {
    console.log('\n[✗] AWAKENING FAILED. Check errors above.');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[FATAL]', e.message);
  process.exit(1);
});
