import { semanticCache } from './lib/semantic-cache.js';
import { cognitiveDriftAgent } from './agents/system/cognitive-drift-agent.js';
import crypto from 'crypto';

console.log("--- Starting Final Cognitive Drift Test ---");

async function runTest() {
  process.env.ENCRYPTION_KEY = "test-secret";
  
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

  let purgeDetected = false;
  let results = [];

  for (let pass = 1; pass <= 4; pass++) {
    console.log(`\n${pass + 2}. Running Drift Agent (Pass ${pass})...`);
    let r = await cognitiveDriftAgent.run();
    console.log(`Status: ${r.status} | Stagnation: ${r.stagnation?.toFixed(2) || 'N/A'}`);
    results.push(r);
    if (r.status === 'targeted_purge') {
      purgeDetected = true;
    }
  }

  console.log("\n6. Verifying Legitimate Data Survived...");
  let legitsSurvived = 0;
  for (let i = 0; i < 5; i++) {
    if (semanticCache.search(`legit-${i}`, "user-legit")) legitsSurvived++;
  }

  if (purgeDetected && legitsSurvived === 5) {
    console.log(`✅ PASS: Drift detected, surgical purge executed, ALL ${legitsSurvived}/5 legitimate entries survived.`);
  } else if (purgeDetected && legitsSurvived > 0) {
    console.log(`⚠️ PARTIAL: Purge happened but only ${legitsSurvived}/5 legit entries survived.`);
  } else if (purgeDetected && legitsSurvived === 0) {
    console.log("❌ FAIL: Purge was not surgical. Legitimate data was destroyed.");
  } else {
    console.log("❌ FAIL: Drift was never detected.");
  }

  process.exit(0);
}
runTest();
