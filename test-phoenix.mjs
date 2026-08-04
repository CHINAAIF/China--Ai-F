import { phoenixAgent } from './agents/system/phoenix-agent.js';
import { writeMemory } from './lib/blackboard.js';
import fs from 'fs';

console.log("--- Starting Phoenix Protocol Test ---");

async function runTest() {
  process.env.ENCRYPTION_KEY = "test-secret-key";

  console.log("\n1. Testing Abort on Poisoned System (Cognitive Freeze)...");
  await writeMemory('system:cognitive_freeze', { active: true, reason: 'Test' }, 10);
  let r1 = await phoenixAgent.run();
  console.log(r1.success === false ? "✅ PASS: Refused to backup poisoned state." : "❌ FAIL: Backed up poisoned state!");

  console.log("\n2. Testing Ash Forge (Healthy State)...");
  await writeMemory('system:cognitive_freeze', { active: false }, 1); // Remove freeze
  let r2 = await phoenixAgent.run();
  
  if (r2.success) {
    console.log("✅ PASS: Ash forged successfully. Hash:", r2.hash.substring(0, 16) + "...");
    
    // Verify file is encrypted (unreadable)
    const files = fs.readdirSync('./phoenix-ashes').filter(f => f.endsWith('.ash'));
    if (files.length > 0) {
      const content = fs.readFileSync(`./phoenix-ashes/${files[0]}`, 'utf8');
      const isEncrypted = !content.includes("constitution_hash") && content.includes("---ASH---");
      console.log(isEncrypted ? "✅ PASS: Ash content is encrypted and unreadable." : "❌ FAIL: Ash content is plaintext!");
    }
  } else {
    console.log("❌ FAIL: Ash forge failed:", r2.error);
  }

  process.exit(0);
}
runTest();
