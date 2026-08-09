import { spawn, execSync } from 'child_process';
import fs from 'fs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log('==========================================================');
console.log('[LIVE TEST] Truth Tribunal Integration (v21.0)');
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

// Test 1: Non-Stream
try {
  const res = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What is 2+2?' }] })
  });
  const data = await res.json();
  assert(res.status === 200 && data.choices, 'Non-Stream: 200 OK', res.status);
  const hasTribunal = JSON.stringify(data).includes('tribunal');
  assert(hasTribunal, 'Non-Stream: Tribunal in response', hasTribunal ? 'found' : 'not found');
} catch (e) { assert(false, 'Non-Stream: ' + e.message); }

// Test 2: Stream
try {
  const res = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in one word.' }], stream: true })
  });
  const text = await res.text();
  assert(res.status === 200 && text.length > 0, 'Stream: 200 OK', res.status);
  const hasTribunal = text.includes('tribunal');
  assert(hasTribunal, 'Stream: Tribunal in metadata', hasTribunal ? 'found' : 'not found');
} catch (e) { assert(false, 'Stream: ' + e.message); }

// Cleanup
console.log('\n[CLEANUP] Terminating...');
server.kill('SIGINT');
await sleep(1000);
try { process.kill(server.pid, 0); server.kill('SIGKILL'); } catch (e) {}

console.log('\n==========================================================');
console.log('[RESULT] Passed: ' + passed + ', Failed: ' + failed);
console.log('==========================================================');
if (failed > 0) process.exit(1);
