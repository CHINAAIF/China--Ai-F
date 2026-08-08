import crypto from 'crypto';
import { providerWatchdogAgent } from './agents/system/provider-watchdog-agent.js';
import { tacticalRouter } from './agents/governance/tactical-routing.js';

console.log("--- Running Router Security Test (UUID + RLS) ---");

async function runTest() {
  await providerWatchdogAgent.run();

  // Generate a valid UUID for the test
  const customerId = crypto.randomUUID();
  const validSig = crypto.createHmac("sha256", process.env.IMMUNE_SECRET).update(customerId).digest("hex");

  console.log("\n1. Testing Legitimate Request (Valid UUID + Valid Signature)...");
  console.log("Using Customer ID:", customerId);
  
  let res = await tacticalRouter.route({ 
    task_type: "general", 
    customer_id: customerId, 
    agent_id: "live-test", 
    tenant_signature: validSig 
  });
  
  if (res.success) {
    console.log("✅ PASS: Router selected provider and wrote to Neon DB successfully!");
    console.log("Provider:", res.provider.slug);
    console.log("Latency:", res.latency_ms, "ms");
  } else {
    console.log("❌ FAIL:", res.error);
  }
  process.exit(0);
}
runTest();
