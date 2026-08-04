import { sovereignProtocol } from './lib/sovereign-protocol.js';
import crypto from 'crypto';

console.log("--- Starting Protocol/Cache Integration Test ---");

async function runTest() {
  process.env.ENCRYPTION_KEY = "test-secret";
  const prompt = "What is 2+2?";
  const userId = "user-integration-1";

  console.log("\n1. Executing via Sovereign Protocol (First Time - Cache Miss)...");
  const result1 = await sovereignProtocol.execute(prompt, 'general', userId);
  console.log("Result:", result1.content ? "Success" : "Failed");

  console.log("\n2. Executing via Sovereign Protocol (Second Time - Should be Cache Hit)...");
  const startTime = performance.now();
  const result2 = await sovereignProtocol.execute(prompt, 'general', userId);
  const duration = performance.now() - startTime;
  
  if (result2.attestation && result2.attestation.cached && duration < 2.0) {
    console.log(`✅ PASS: Served from Hot Memory in ${duration.toFixed(3)} ms.`);
  } else {
    console.log(`❌ FAIL: Did not use cache or too slow (${duration.toFixed(3)} ms).`);
  }
}
runTest();
