import { writeMemory, readMemory, flushMemory, generateMemoryToken } from './lib/blackboard.js';

console.log("--- Starting Cyber Spoofing Test (V2) ---");

async function runTest() {
  await flushMemory();

  const victimToken = generateMemoryToken('victim_agent');
  const attackerToken = generateMemoryToken('attacker_agent');
  const fakeToken = "fake_token_12345";

  console.log("\n1. Testing Missing Token...");
  let res1 = await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, null);
  console.log(res1 === false ? "✅ PASS: Write blocked (Missing Token)." : "❌ FAIL: Wrote without token!");

  console.log("\n2. Testing Fake Token...");
  let res2 = await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, fakeToken);
  console.log(res2 === false ? "✅ PASS: Write blocked (Fake Token)." : "❌ FAIL: Wrote with fake token!");

  console.log("\n3. Testing Identity Spoofing (Attacker uses own token to write as victim)...");
  let res3 = await writeMemory('agent:victim_agent:data', { secret: 'stolen' }, 60, attackerToken);
  console.log(res3 === false ? "✅ PASS: Write blocked (Identity Spoofing)." : "❌ FAIL: Attacker wrote as victim!");

  console.log("\n4. Testing Legitimate Write (Victim writes to own memory)...");
  let res4 = await writeMemory('agent:victim_agent:data', { secret: 'safe' }, 60, victimToken);
  if (res4 === true) {
    const data = await readMemory('agent:victim_agent:data');
    console.log(data && data.secret === 'safe' ? "✅ PASS: Legitimate write succeeded." : "❌ FAIL: Data not saved.");
  } else {
    console.log("❌ FAIL: Legitimate write was blocked!");
  }

  process.exit(0);
}
runTest();
