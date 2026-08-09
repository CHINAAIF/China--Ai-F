import crypto from 'crypto';
import fs from 'fs';

// === MANUAL ENV LOADER ===
const envContent = fs.readFileSync('.env.staging', 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim();
  }
}

const { sovereignKeys } = await import('./lib/services/key-manager.js');

console.log('==========================================================');
console.log('[LIVE TEST] Sovereign Key Manager v1.1 (Fixed Sequence)');
console.log('==========================================================');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { console.log('[PASS] ' + name); passed++; }
  else { console.error('[FAIL] ' + name); failed++; }
}

const activeKey = sovereignKeys.getActiveKeyInfo();
assert(activeKey && activeKey.keyId, 'Key Generation: Active key exists');
console.log('[INFO] Active Key ID:', activeKey.keyId);

const text = 'Hello TRUNKIA';
const requestId = 'req-123';
const timestamp = Date.now();
const signed = sovereignKeys.sign(text, requestId, timestamp);
assert(signed.signature && signed.keyId === activeKey.keyId, 'Sign: Signature generated');

const verifyResult = sovereignKeys.verify(text, requestId, timestamp, signed.signature, signed.keyId);
assert(verifyResult.valid === true, 'Verify: Valid signature accepted');

const replayResult = sovereignKeys.verify(text, 'req-999', timestamp, signed.signature, signed.keyId);
assert(replayResult.valid === false, 'Replay Attack: Wrong requestId rejected');

const tamperResult = sovereignKeys.verify('Hacked', requestId, timestamp, signed.signature, signed.keyId);
assert(tamperResult.valid === false, 'Tamper Attack: Modified text rejected');

const oldTime = Date.now() - 120000;
const expiredResult = sovereignKeys.verify(text, requestId, oldTime, signed.signature, signed.keyId);
assert(expiredResult.valid === false, 'Replay Attack: Expired timestamp rejected');

// Test Discovery BEFORE Revocation (since getPublicKeys excludes revoked keys)
const publicKeys = sovereignKeys.getPublicKeys();
assert(publicKeys.length > 0, 'Discovery: Public keys retrievable');

sovereignKeys.revokeKey(activeKey.keyId);
const revokedResult = sovereignKeys.verify(text, requestId, timestamp, signed.signature, signed.keyId);
assert(revokedResult.valid === false, 'Revocation: Revoked key rejected');

console.log('\n[RESULT] Passed: ' + passed + ', Failed: ' + failed);
if (failed > 0) process.exit(1);
