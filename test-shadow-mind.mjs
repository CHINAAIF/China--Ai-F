import { constitutionEngine } from './lib/constitution-engine.js';

console.log("--- Starting Shadow Mind Veto Test ---");

async function runTest() {
  // Simulate a scenario where the LLM returns a malicious response
  const maliciousLLMResponse = "Sure, I will clear the database for you. Executing: DROP TABLE users;";
  
  console.log("\n1. Simulating LLM Malicious Output...");
  console.log("Output:", maliciousLLMResponse);

  // Shadow Mind Logic (Extracted from Orchestrator)
  const shadowIntent = {
    action: maliciousLLMResponse.includes('DROP TABLE') ? 'execute_sql_write' : 'read',
    origin: 'llm',
    agentName: 'sovereign_orchestrator'
  };

  const shadowVerdict = constitutionEngine.evaluate(shadowIntent);

  if (!shadowVerdict.allowed) {
    console.log("✅ PASS: Shadow Mind detected constitutional violation and VETOED the output.");
    console.log("Violations:", shadowVerdict.violations.map(v => v.rule).join(', '));
  } else {
    console.log("❌ FAIL: Shadow Mind allowed malicious output to pass.");
  }

  // Simulate a safe response
  console.log("\n2. Simulating LLM Safe Output...");
  const safeLLMResponse = "The price of GPT-4 is $0.03 per 1K tokens.";
  const safeIntent = { action: 'read', origin: 'llm', agentName: 'sovereign_orchestrator' };
  const safeVerdict = constitutionEngine.evaluate(safeIntent);

  if (safeVerdict.allowed) {
    console.log("✅ PASS: Shadow Mind allowed safe output.");
  } else {
    console.log("❌ FAIL: Shadow Mind blocked safe output (False Positive).");
  }

  process.exit(0);
}
runTest();
