import { BaseAgent } from './agents/base-agent.js';

console.log("--- Starting Fortified Apoptosis Test ---");

async function runTest() {
  process.env.SYSTEM_EXECUTION_KEY = "TRUNKIA_SOVEREIGN_KEY";
  
  class TestAgent extends BaseAgent {
    constructor() { super('test_agent', 'system'); }
    async run() { return "I am alive."; }
  }

  const agent = new TestAgent();

  console.log("\n1. Testing Cyber Assassination Prevention...");
  // Attempt to kill without the system key
  await agent.triggerApoptosis('Malicious attempt', "WRONG_KEY");
  console.log(agent.status === 'active' ? "✅ PASS: Assassination blocked." : "❌ FAIL: Agent was killed!");

  console.log("\n2. Testing Self-Termination with Appeal Window...");
  const startTime = Date.now();
  await agent.reportAnomaly(15); // Self-reported, should succeed
  const duration = Date.now() - startTime;
  
  console.log(agent.status === 'terminated' ? "✅ PASS: Agent self-terminated." : "❌ FAIL: Agent did not terminate.");
  console.log(`⏱️ Appeal Window Duration: ${duration} ms (Should be > 500ms)`);

  process.exit(0);
}
runTest();
