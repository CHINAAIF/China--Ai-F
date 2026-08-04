import { BaseAgent } from './agents/base-agent.js';

console.log("--- Starting Digital Apoptosis Test (V2) ---");

async function runTest() {
  class TestAgent extends BaseAgent {
    constructor() { super('test_agent', 'system'); }
    // This run method tries to bypass the check
    async run() { return "I bypassed security!"; }
  }

  const agent = new TestAgent();
  
  console.log("\n1. Triggering Apoptosis (Anomaly Score > 10)...");
  await agent.reportAnomaly(15);
  console.log(agent.status === 'terminated' ? "✅ PASS: Agent self-terminated." : "❌ FAIL: Agent did not terminate.");

  console.log("\n2. Testing Zombie Execution Prevention (Bypass Attempt)...");
  try {
    await agent.run();
    console.log("❌ FAIL: Dead agent executed code and bypassed security!");
  } catch (err) {
    console.log("✅ PASS: Dead agent blocked from execution:", err.message);
  }
  
  process.exit(0);
}
runTest();
