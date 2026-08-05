import { HARDENED_DB_CONFIG, SovereignMemoryStore, sanitizePayload } from './lib/sovereign-hardened-core.js';

console.log("=== 🧪 STARTING LIVE TRUNKIA SECURITY TESTS (ESM) ===");

console.log("\n1. Testing DB Pool Lock Configuration...");
if (HARDENED_DB_CONFIG.connectionLimit === 1) {
    console.log("   ✅ PASS: Connection Limit strictly set to 1.");
} else {
    console.error("   ❌ FAIL: DB Pool limit breached!");
    process.exit(1);
}

console.log("\n2. Testing RAM-Only Nonce Consumption...");
const vault = new SovereignMemoryStore(5000);
const testNonce = "nonce_secret_token_12345";

vault.set(testNonce, true);
const firstCheck = vault.hasAndConsume(testNonce);
const secondCheck = vault.hasAndConsume(testNonce);

if (firstCheck && !secondCheck) {
    console.log("   ✅ PASS: Nonce consumed instantly. Replay Attack blocked!");
} else {
    console.error("   ❌ FAIL: Nonce consumption flaw detected!");
    process.exit(1);
}

console.log("\n3. Testing Payload Sanitization & Size Limit...");
const cleanData = sanitizePayload({ prompt: "Hello\u200B World" });
if (cleanData.prompt === "Hello World") {
    console.log("   ✅ PASS: Zero-Width Space sanitized successfully.");
} else {
    console.error("   ❌ FAIL: ZWS Leak detected!");
    process.exit(1);
}

try {
    const hugeBuffer = "A".repeat(60000);
    sanitizePayload({ data: hugeBuffer });
    console.error("   ❌ FAIL: Oversized payload was not rejected!");
    process.exit(1);
} catch (err) {
    if (err.message === "PAYLOAD_SIZE_EXCEEDED") {
        console.log("   ✅ PASS: Oversized payload (>50KB) rejected correctly.");
    } else {
        console.error("   ❌ FAIL: Unexpected error:", err.message);
        process.exit(1);
    }
}

console.log("\n=== 🏆 ALL TESTS PASSED SUCCESSFULLY! SAFE TO COMMIT. ===");
