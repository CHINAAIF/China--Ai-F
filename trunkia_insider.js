import { getPool } from './lib/db.js';

console.log("--- Insider Threat Simulation ---");

async function attack() {
  console.log("Attempting to access 'governance' pool without token...");
  try {
    const p = getPool('governance');
    console.log("❌ FAIL: Insider acquired pool without token!");
  } catch (err) {
    console.log("✅ PASS: Insider blocked by Cryptographic Lock:", err.message);
  }
}
attack();
