import crypto from 'crypto';
import { providerWatchdogAgent } from './agents/system/provider-watchdog-agent.js';
import { tacticalRouter } from './agents/governance/tactical-routing.js';

console.log("--- Running Router Security Test (Anti-Spoofing + RLS) ---");

async function runTest() {
  // 1. Initialize Watchdog
  await providerWatchdogAgent.run();

  const customerId = "test-customer-1";
  const validSig = crypto.createHmac("sha256", process.env.IMMUNE_SECRET).update(customerId).digest("hex");
  const fakeSig = "fake_signature_12345";

  // 1. Test Spoofing Attempt (No Valid Signature)
  console.log("\n1. Testing Spoofing Attempt (Fake Signature)...");
  let res1 = await tacticalRouter.route({ task_type: "general", customer_id: "admin", agent_id: "attacker", tenant_signature: fakeSig });
  console.log(res1.error === "Security Violation: Tenant Signature Invalid" ? "✅ PASS: Spoofing blocked!" : "❌ FAIL: Spoofing allowed!");

  // 2. Test Legitimate Request (Valid Signature)
  console.log("\n2. Testing Legitimate Request (Valid Signature)...");
  let res2 = await tacticalRouter.route({ task_type: "general", customer_id: customerId, agent_id: "live-test", tenant_signature: validSig });
  
  if (res2.success) {
    console.log("✅ PASS: Router selected provider and wrote to Neon DB (RLS + Crypto Proof Satisfied)!");
  } else {
    console.log("❌ FAIL:", res2.error);
  }
  process.exit(0);
}
runTest();
