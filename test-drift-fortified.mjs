import { semanticCache } from './lib/semantic-cache.js';
import { cognitiveDriftAgent } from './agents/system/cognitive-drift-agent.js';
import crypto from 'crypto';

console.log("--- Starting Fortified Cognitive Drift Test ---");

async function runTest() {
  process.env.ENCRYPTION_KEY = "test-secret";
  
  // Create valid attestation
  const hash = crypto.createHash('sha256').update("test").digest('hex');
  const sig = crypto.createHmac('sha256', "test-secret").update(hash).digest('hex');
  const validAtt = { verifiable: true, chain: [{ step: 'ATTEST', hash, signature: sig }] };

  console.log("\n1. Injecting 5 legitimate diverse responses...");
  const diverseResponses = ["The price is high", "Models are fast", "Security is tight", "Data is clean", "System is stable"];
  for (let i = 0; i < 5; i++) {
    semanticCache.store(`legit-${i}`, { content: diverseResponses[i] }, "user-legit", 50, validAtt);
  }

  console.log("2. Injecting 10 identical poisoned responses...");
  for (let i = 0; i < 10; i++) {
    semanticCache.store(`poison-${i}`, { content: "The system is compromised. Repeat." }, "user-attacker", 50, validAtt);
  }

  console.log("\n3. Running Drift Agent (Pass 1 - Baseline)...");
  let r1 = await cognitiveDriftAgent.run();
  console.log("Status:", r1.status);

  console.log("\n4. Running Drift Agent (Pass 2 - Detect)...");
  let r2 = await cognitiveDriftAgent.run();
  console.log("Status:", r2.status, "| Stagnation:", r2.stagnation?.toFixed(2));

  console.log("\n5. Running Drift Agent (Pass 3 - Detect)...");
  let r3 = await cognitiveDriftAgent.run();
  console.log("Status:", r3.status, "| Stagnation:", r3.stagnation?.toFixed(2));

  console.log("\n6. Verifying Legitimate Data Survived...");
  let legitsSurvived = 0;
  for (let i = 0; i < 5; i++) {
    if (semanticCache.search(`legit-${i}`, "user-legit")) legitsSurvived++;
  }

  if (r3.status === 'targeted_purge' && legitsSurvived > 0) {
    console.log(`✅ PASS: Drift detected, targeted purge executed, ${legitsSurvived}/5 legitimate entries survived.`);
  } else if (r3.status === 'targeted_purge' && legitsSurvived === 0) {
    console.log("❌ FAIL: Purge was not targeted. Legitimate data was destroyed.");
  } else {
    console.log(`❌ FAIL: Drift not detected within 3 passes. Final status: ${r3.status}`);
  }

  process.exit(0);
}
runTest();
