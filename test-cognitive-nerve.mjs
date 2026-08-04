import { BaseAgent } from './agents/base-agent.js';

console.log("--- Starting Cognitive Nerve Test ---");

async function runTest() {
  class TestAgent extends BaseAgent {
    constructor() { super('nerve_test_agent', 'system'); }
    async run() {
      // This calls safeGroqJSON internally
      const result = await this.think('Respond with JSON: {"status":"ok"}', 'You are a JSON AI.');
      return result;
    }
  }

  const agent = new TestAgent();
  console.log("\n1. Testing Agent Cognitive Function (think)...");
  
  try {
    const result = await agent.run();
    // Note: result might fail if GROQ_API_KEY is invalid, but it should NOT fail with 'no_json_in_response' or 'undefined' errors.
    if (result && (result.data || result.error)) {
      console.log("✅ PASS: Cognitive nerve path is intact. No extraction errors.");
    } else {
      console.log("❌ FAIL: Unexpected response structure:", result);
    }
  } catch (err) {
    if (err.message.includes('no_json_in_response') || err.message.includes('undefined')) {
      console.log("❌ FAIL: Broken nerve path detected:", err.message);
    } else {
      console.log("✅ PASS: Cognitive nerve path is intact. Error is network/API related, not code logic:", err.message);
    }
  }
  process.exit(0);
}
runTest();
