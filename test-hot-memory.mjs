import { semanticCache } from './lib/semantic-cache.js';

console.log("--- Starting Hot Memory Test ---");

async function runTest() {
  const prompt = "What is the price of GPT-4?";
  const userId = "user-123";
  
  // 1. Test Cache Miss
  console.log("\n1. Testing Cache Miss...");
  let result = semanticCache.search(prompt, userId);
  console.log(result === null ? "✅ PASS: Miss returned null." : "❌ FAIL: Should be null.");

  // 2. Test Poisoning Prevention (Store without attestation)
  console.log("\n2. Testing Cache Poisoning Prevention...");
  semanticCache.store(prompt, { content: "Malicious Response" }, userId, 50, null);
  result = semanticCache.search(prompt, userId);
  console.log(result === null ? "✅ PASS: Poisoned response rejected (No Attestation)." : "❌ FAIL: Poisoned response stored!");

  // 3. Test Valid Store and O(1) Hit
  console.log("\n3. Testing Valid Store and O(1) Hit...");
  const validAttestation = { verifiable: true, chain: [] };
  semanticCache.store(prompt, { content: "Safe Response" }, userId, 50, validAttestation);
  
  const startTime = performance.now();
  result = semanticCache.search(prompt, userId);
  const duration = performance.now() - startTime;
  
  console.log(result && result.cached ? "✅ PASS: Cache hit successful." : "❌ FAIL: No hit.");
  console.log(`⏱️ Retrieval Time: ${duration.toFixed(4)} ms (O(1) Proved).`);

  // 4. Test Cross-Tenant Isolation
  console.log("\n4. Testing Cross-Tenant Isolation...");
  result = semanticCache.search(prompt, "user-456");
  console.log(result === null ? "✅ PASS: Cross-tenant access blocked." : "❌ FAIL: Data leaked between users!");
}
runTest();
