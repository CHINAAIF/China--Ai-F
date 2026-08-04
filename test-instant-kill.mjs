import { BaseAgent } from './agents/base-agent.js';

console.log("--- Starting Instant Kill Apoptosis Test ---");

async function runTest() {
  process.env.SYSTEM_EXECUTION_KEY = "TRUNKIA_SOVEREIGN_KEY";
  
  class TestAgent extends BaseAgent {
    constructor() { super('test_agent', 'system'); }
    async run() { return "I am alive."; }
  }

  const agent = new TestAgent();

  console.log("\n1. Testing Instant Self-Termination...");
  const startTime = performance.now();
  await agent.reportAnomaly(15); // Should be instant
  const duration = performance.now() - startTime;
  
  console.log(agent.status === 'terminated' ? "✅ PASS: Agent terminated." : "❌ FAIL: Agent did not terminate.");
  console.log(`⏱️ Kill Duration: ${duration.toFixed(2)} ms (Should be < 10ms)`);

  // Allow background tasks to flush
  await new Promise(r => setTimeout(r, 1000));
  process.exit(0);
}
runTest();
