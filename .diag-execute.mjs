import fs from 'fs';

// 1. Load env manually
const env = fs.readFileSync('.env.staging', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
process.env.NODE_ENV = 'staging';

// 2. Import Protocol directly
const { sovereignProtocol } = await import('./lib/sovereign-protocol.js');

console.log('==========================================================');
console.log('[DIAG] Calling sovereignProtocol.execute() directly...');
console.log('==========================================================');

try {
  const result = await sovereignProtocol.execute('What is 2+2?', 'general', 'diag-user', null, 'diag-trace');
  console.log('[SUCCESS] Content:', result.content);
  console.log('[SUCCESS] Attestation:', JSON.stringify(result.attestation).substring(0, 200));
} catch (e) {
  console.error('\n[FATAL ERROR CAUGHT]');
  console.error('Message:', e.message);
  console.error('Stack:', e.stack);
}
