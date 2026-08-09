import { spawn, execSync } from 'child_process';
import fs from 'fs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('==========================================================');
console.log('[UNIVERSAL BINDING TEST] Complete Integration');
console.log('==========================================================');

let passed = 0, failed = 0;
function assert(cond, name, detail) {
  if (cond) { console.log('[PASS] ' + name); passed++; }
  else { console.error('[FAIL] ' + name + (detail ? ' (got: ' + detail + ')' : '')); failed++; }
}

const envFile = fs.readFileSync('.env.staging', 'utf8');
const envVars = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
});

try { execSync('pkill -9 -f "node index.js"', { stdio: 'ignore' }); } catch (e) {}
await sleep(1000);

const server = spawn('node', ['index.js'], {
  env: { ...process.env, ...envVars, IMMUNE_SECRET: 'trunkia_immune_2026', PORT: '9090', BYPASS_AUTH: 'true' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
server.stdout.on('data', d => { logs += d.toString(); });
server.stderr.on('data', d => { logs += d.toString(); });

let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9090/ping');
    if (res.ok) { ready = true; console.log('[SERVER] Ready.'); break; }
  } catch (e) {}
  await sleep(500);
}
if (!ready) { console.error('[FATAL] Server not ready.\n' + logs.substring(logs.length - 1000)); server.kill('SIGKILL'); process.exit(1); }

const baseUrl = 'http://127.0.0.1:9090';

// Test 1: /health
try {
  const res = await fetch(baseUrl + '/health');
  const data = await res.json();
  assert(res.status === 200 && data.phase === 7, '/health: Phase ' + data.phase, res.status);
} catch (e) { assert(false, '/health: ' + e.message); }

// Test 2: /api/agents
try {
  const res = await fetch(baseUrl + '/api/agents');
  const data = await res.json();
  assert(res.status === 200 && data.count > 0, '/api/agents: ' + data.count + ' agents', res.status);
} catch (e) { assert(false, '/api/agents: ' + e.message); }

// Test 3: Honeypot (404)
try {
  const res = await fetch(baseUrl + '/api/supervisor/diagnostic');
  assert(res.status === 404, 'Honeypot: 404', res.status);
} catch (e) { assert(false, 'Honeypot: ' + e.message); }

// Test 4: Rate Limiter Status
try {
  const res = await fetch(baseUrl + '/api/sovereign/rate-limiter/status');
  const data = await res.json();
  assert(res.status === 200 && data.circuit !== undefined, 'Rate Limiter Status', res.status);
} catch (e) { assert(false, 'Rate Limiter: ' + e.message); }

// Test 5: Command Center
try {
  const res = await fetch(baseUrl + '/api/sovereign/command-center');
  const data = await res.json();
  assert(res.status === 200 && data.sovereignHealth !== undefined, 'Command Center', res.status);
} catch (e) { assert(false, 'Command Center: ' + e.message); }

// Test 6: Audit Verify
try {
  const res = await fetch(baseUrl + '/api/sovereign/audit/verify');
  const data = await res.json();
  assert(res.status === 200 && data.valid !== undefined, 'Audit Verify', res.status);
} catch (e) { assert(false, 'Audit Verify: ' + e.message); }

// Test 7: Stream Request
try {
  const res = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in one word.' }], stream: true })
  });
  const text = await res.text();
  assert(res.status === 200 && text.length > 0, 'Stream: 200 OK (' + text.length + 'b)', res.status);
} catch (e) { assert(false, 'Stream: ' + e.message); }

// Test 8: Non-Stream Request
try {
  const res = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What is 2+2?' }] })
  });
  const data = await res.json();
  assert(res.status === 200 && data.choices, 'Non-Stream: 200 OK', res.status);
} catch (e) { assert(false, 'Non-Stream: ' + e.message); }

// Cleanup
console.log('\n[CLEANUP] Terminating...');
server.kill('SIGINT');
await sleep(1000);
try { process.kill(server.pid, 0); server.kill('SIGKILL'); } catch (e) {}

console.log('\n==========================================================');
console.log('[RESULT] Passed: ' + passed + ', Failed: ' + failed);
console.log('==========================================================');
if (failed > 0) process.exit(1);
