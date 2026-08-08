import { BaseAgent } from './agents/base-agent.js';

console.log("--- Starting Digital Apoptosis Test ---");

async function runTest() {
  class TestAgent extends BaseAgent {
    constructor() { super('test_agent', 'system'); }
    async run() { return "I am alive and running."; }
  }

  const agent = new TestAgent();
  console.log("\n1. Testing Normal Execution...");
  const normalRun = await agent.run();
  console.log(normalRun === "I am alive and running." ? "✅ PASS: Agent executed normally." : "❌ FAIL: Agent did not run.");

  console.log("\n2. Triggering Apoptosis (Anomaly Score > 10)...");
  await agent.reportAnomaly(15); // Triggers self-destruct
  
  console.log("Agent Status:", agent.status);
  console.log(agent.status === 'terminated' ? "✅ PASS: Agent self-terminated." : "❌ FAIL: Agent did not terminate.");

  console.log("\n3. Testing Zombie Execution Prevention...");
  try {
    await agent.run();
    console.log("❌ FAIL: Dead agent executed code!");
  } catch (err) {
    console.log("✅ PASS: Dead agent blocked from execution:", err.message);
  }
}
runTest();
