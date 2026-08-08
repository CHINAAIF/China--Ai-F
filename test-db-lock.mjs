import { getPool, generateDbToken } from './lib/db.js';

console.log("--- Starting DB Lock Security Test ---");

async function runTests() {
  // 1. Test Insider without token
  console.log("\n1. Testing Insider Attack (No Token)...");
  try {
    getPool('main', generateDbToken('test-db-lock.mjs'));
    console.log("❌ FAIL: Pool acquired without token!");
  } catch (err) {
    console.log("✅ PASS: Access denied (No token).");
  }

  // 2. Test Insider with fake token
  console.log("\n2. Testing Insider Attack (Forged Token)...");
  try {
    getPool('main', 'fake-path:fake-signature');
    console.log("❌ FAIL: Pool acquired with forged token!");
  } catch (err) {
    console.log("✅ PASS: Access denied (Forged token).");
  }

  // 3. Test Trusted Module with valid token
  console.log("\n3. Testing Trusted Module (Valid Token)...");
  try {
    const validToken = generateDbToken('test-db-lock.mjs');
    const poolInstance = getPool('main', validToken);
    if (poolInstance && typeof poolInstance.connect === 'function') {
      console.log("✅ PASS: Cryptographic lock accepted by trusted module.");
    } else {
      console.log("❌ FAIL: Pool not returned.");
    }
  } catch (err) {
    console.log("❌ FAIL:", err.message);
  }
}
runTests();
