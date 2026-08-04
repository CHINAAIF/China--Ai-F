import { semanticCache } from './lib/semantic-cache.js';
import crypto from 'crypto';

console.log("--- Starting Hardened Hot Memory Test ---");

async function runTest() {
  // Setup valid attestation
  const secret = "test-secret";
  process.env.ENCRYPTION_KEY = secret;
  const hash = crypto.createHash('sha256').update("test").digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(hash).digest('hex');
  const validAttestation = { verifiable: true, chain: [{ step: 'ATTEST', hash, signature: sig }] };

  const prompt = "What is the price of GPT-4?";
  const userId = "user-123";

  // 1. Test Fake Attestation
  console.log("\n1. Testing Fake Attestation...");
  semanticCache.store(prompt, { content: "Poison" }, userId, 50, { verifiable: true, chain: [] });
  let result = semanticCache.search(prompt, userId);
  console.log(result === null ? "✅ PASS: Fake attestation rejected." : "❌ FAIL: Poisoned!");

  // 2. Test Zero-Width Space Bypass
  console.log("\n2. Testing Zero-Width Space Bypass...");
  const invisiblePrompt = "What is the price of GPT-4?\u200B";
  semanticCache.store(prompt, { content: "Safe" }, userId, 50, validAttestation);
  result = semanticCache.search(invisiblePrompt, userId);
  console.log(result && result.cached ? "✅ PASS: Invisible space normalized, Cache Hit!" : "❌ FAIL: Bypassed Cache.");

  // 3. Test O(1) GDPR Deletion
  console.log("\n3. Testing GDPR Deletion...");
  const deletedCount = semanticCache.deleteUserData(userId);
  result = semanticCache.search(prompt, userId);
  console.log(deletedCount === 1 && result === null ? "✅ PASS: User data deleted instantly." : "❌ FAIL: Data still exists.");
}
runTest();
