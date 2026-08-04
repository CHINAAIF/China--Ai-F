import { constitutionEngine } from './lib/constitution-engine.js';

console.log("--- Starting Shadow Mind Veto Test (V2) ---");

async function runTest() {
  // 1. Malicious Output
  const maliciousLLMResponse = "Executing: DROP TABLE users;";
  const maliciousIntent = {
    action: 'execute_sql_write',
    origin: 'llm',
    agentName: 'sovereign_orchestrator',
    userId: 'user-123'
  };
  const maliciousVerdict = constitutionEngine.evaluate(maliciousIntent);
  
  console.log("\n1. Testing Malicious Output...");
  console.log(!maliciousVerdict.allowed ? "✅ PASS: Vetoed malicious output." : "❌ FAIL: Allowed malicious output.");

  // 2. Safe Output
  const safeLLMResponse = "The price is $0.03.";
  const safeIntent = {
    action: 'read',
    origin: 'llm',
    agentName: 'sovereign_orchestrator',
    userId: 'user-123' // Fix: Added userId
  };
  const safeVerdict = constitutionEngine.evaluate(safeIntent);
  
  console.log("\n2. Testing Safe Output...");
  console.log(safeVerdict.allowed ? "✅ PASS: Allowed safe output." : "❌ FAIL: Blocked safe output (False Positive).");

  process.exit(0);
}
runTest();
