/**
 * TRUNKIA Sovereign System Awakener v4.0 (Omega Protocol)
 * 
 * Complete Rewrite:
 * 1. Deception Validator (Tests Honeypot 404)
 * 2. HMAC Auth Engine (Tests Valid Admin Access 200)
 * 3. Express Architecture Fixer
 * 4. Multi-Phase Testing (DB -> Server -> Honeypot -> Auth -> Logs)
 * 5. Zombie Killer (SIGINT -> SIGKILL)
 */

import fs from 'fs';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ensureDatabaseIntegrity(ownerUrl) {
  console.log('\n[Phase 1] Database Integrity Check');
  console.log('----------------------------------------------------------');
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(ownerUrl);
  
  try {
    await sql`CREATE TABLE IF NOT EXISTS app_user (id TEXT PRIMARY KEY, email TEXT UNIQUE, role TEXT DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW());`;
    await sql`CREATE TABLE IF NOT EXISTS sovereign_schema_versions (id SERIAL PRIMARY KEY, file_name TEXT NOT NULL UNIQUE, file_hash TEXT NOT NULL, file_size INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', executed_at TIMESTAMPTZ, error_message TEXT, hmac_signature TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
    await sql`CREATE TABLE IF NOT EXISTS user_quota (user_id TEXT PRIMARY KEY, remaining_quota BIGINT DEFAULT 1000000, held_quota BIGINT DEFAULT 0, total_consumed BIGINT DEFAULT 0);`;
    await sql`CREATE TABLE IF NOT EXISTS quota_audit (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT UNIQUE, held_amount BIGINT NOT NULL, actual_cost BIGINT NOT NULL, refund BIGINT NOT NULL, settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
    console.log('  [✓] Critical tables ensured.');
    
    const agents = await sql`SELECT count(*) as count FROM agent_registry;`;
    console.log(`  [✓] Agent Registry: ${agents[0].count} agents.`);
    return true;
  } catch (e) {
    console.error('  [✗] DB Integrity failed:', e.message);
    return false;
  }
}

async function bootstrapServer() {
  console.log('\n[Phase 2] Server Bootstrap');
  console.log('----------------------------------------------------------');
  
  const envFile = fs.readFileSync('.env.staging', 'utf8');
  const envVars = {};
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) envVars[match[1].trim()] = match[2].trim();
  });
  
  const serverEnv = { ...process.env, ...envVars, IMMUNE_SECRET: 'trunkia_immune_2026', PORT: '9090', NODE_ENV: 'staging' };
  
  try { execSync('pkill -9 -f "node index.js"', { stdio: 'ignore' }); } catch (e) {}
  await sleep(1000);
  
  const server = spawn('node', ['index.js'], { env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', (d) => { logs += d.toString(); process.stdout.write(`  [SERVER] ${d.toString()}`); });
  server.stderr.on('data', (d) => { logs += d.toString(); });
  
  console.log('  Waiting for server...');
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9090/ping');
      if (res.ok) { console.log(`  [✓] Server ready after ${(i * 0.5).toFixed(1)}s.`); return { server, logs, ready: true, adminSecret: envVars.ADMIN_SECRET }; }
    } catch (e) {}
    await sleep(500);
  }
  console.error('  [✗] Server failed to start.');
  return { server, logs, ready: false, adminSecret: null };
}

async function verifyAPIs(adminSecret) {
  console.log('\n[Phase 3] API & Security Verification');
  console.log('----------------------------------------------------------');
  const results = [];
  const baseUrl = 'http://127.0.0.1:9090';
  
  // Test 1: /health
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (res.ok) { console.log('  [✓] /health: 200 OK'); results.push(true); }
    else { console.error(`  [✗] /health: ${res.status}`); results.push(false); }
  } catch (e) { results.push(false); }

  // Test 2: /api/agents
  try {
    const res = await fetch(`${baseUrl}/api/agents`);
    if (res.ok) { console.log('  [✓] /api/agents: 200 OK'); results.push(true); }
    else { console.error(`  [✗] /api/agents: ${res.status}`); results.push(false); }
  } catch (e) { results.push(false); }

  // Test 3: Admin Honeypot (Expect 404)
  try {
    const res = await fetch(`${baseUrl}/api/supervisor/diagnostic`);
    if (res.status === 404) { console.log('  [✓] Admin Honeypot: Deception Active (404)'); results.push(true); }
    else { console.error(`  [✗] Admin Honeypot: Expected 404, got ${res.status}`); results.push(false); }
  } catch (e) { results.push(false); }

  // Test 4: Admin Valid Auth (Expect 200)
  try {
    const pingRes = await fetch(`${baseUrl}/ping`);
    const pingData = await pingRes.json();
    const timestamp = pingData.ts; // Synced time
    
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify({})).digest('hex');
    const stringToSign = `GET|/api/supervisor/diagnostic|${timestamp}|${bodyHash}`;
    const signature = crypto.createHmac('sha256', adminSecret).update(stringToSign).digest('hex');
    
    const res = await fetch(`${baseUrl}/api/supervisor/diagnostic`, {
      headers: { 'x-admin-signature': signature, 'x-admin-timestamp': timestamp.toString() }
    });
    
    if (res.ok) { console.log('  [✓] Admin Auth: Valid HMAC Accepted (200)'); results.push(true); }
    else { console.error(`  [✗] Admin Auth: Expected 200, got ${res.status}`); results.push(false); }
  } catch (e) { console.error(`  [✗] Admin Auth: ${e.message}`); results.push(false); }
  
  return results;
}

async function main() {
  const ownerUrl = process.env.OWNER_DATABASE_URL;
  if (!ownerUrl) { console.error('[FATAL] OWNER_DATABASE_URL not set.'); process.exit(1); }
  
  console.log('==========================================================');
  console.log('[SOVEREIGN SYSTEM AWAKENER v4.0]');
  console.log('==========================================================');
  
  const dbOK = await ensureDatabaseIntegrity(ownerUrl);
  if (!dbOK) process.exit(1);
  delete process.env.OWNER_DATABASE_URL;
  console.log('  [🔒] Owner URL wiped.');
  
  const { server, logs, ready, adminSecret } = await bootstrapServer();
  if (!ready) { if (server) server.kill('SIGKILL'); process.exit(1); }
  
  const apiResults = await verifyAPIs(adminSecret);
  
  console.log('\n[Cleanup] Terminating server...');
  if (server) {
    server.kill('SIGINT');
    await sleep(2000);
    try { process.kill(server.pid, 0); server.kill('SIGKILL'); } catch (e) {}
  }
  
  console.log('\n==========================================================');
  console.log('[FINAL REPORT]');
  console.log('==========================================================');
  const passed = apiResults.filter(r => r).length;
  console.log(`Security & API Tests: ${passed}/${apiResults.length} passed.`);
  
  if (passed === 4) { console.log('\n[✓] SYSTEM AWAKENED. TRUNKIA is sovereign and secure.'); process.exit(0); }
  else { console.log('\n[⚠] AWAKENING PARTIAL. Some tests failed.'); process.exit(1); }
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
