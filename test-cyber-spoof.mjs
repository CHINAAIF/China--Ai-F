import { writeMemory, readMemory, flushMemory, generateMemoryToken } from './lib/blackboard.js';

console.log("--- Starting Cyber Spoofing Test ---");

async function runTest() {
  process.env.IMMUNE_SECRET = "test-secret"; // Already loaded by env, but for safety
  await flushMemory();

  const victimToken = generateMemoryToken('victim_agent');
  const attackerToken = generateMemoryToken('attacker_agent');
  const fakeToken = "fake_token_12345";

  console.log("\n1. Testing Missing Token...");
  try {
    await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, null);
    console.log("❌ FAIL: Wrote without token!");
  } catch (e) { console.log("✅ PASS:", e.message); }

  console.log("\n2. Testing Fake Token...");
  try {
    await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, fakeToken);
    console.log("❌ FAIL: Wrote with fake token!");
  } catch (e) { console.log("✅ PASS:", e.message); }

  console.log("\n3. Testing Identity Spoofing (Attacker uses own token to write as victim)...");
  try {
    await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, attackerToken);
    console.log("❌ FAIL: Attacker wrote as victim!");
  } catch (e) { console.log("✅ PASS:", e.message); }

  console.log("\n4. Testing Legitimate Write (Victim writes to own memory)...");
  try {
    await writeMemory('agent:victim_agent:data', { secret: 'safe' }, 60, victimToken);
    const data = await readMemory('agent:victim_agent:data');
    console.log(data && data.secret === 'safe' ? "✅ PASS: Legitimate write succeeded." : "❌ FAIL: Data not saved.");
  } catch (e) { console.log("❌ FAIL:", e.message); }

  process.exit(0);
}
runTest();
