import { truthTribunalAgent } from './agents/learning/truth-tribunal-agent.js';

console.log("--- Starting Truth Tribunal Test ---");

async function runTest() {
  console.log("\nExecuting Truth Tribunal (This may take a few seconds for LLM consensus)...");
  
  // Note: This will return 'no_items' if DB is empty, which is a valid success.
  // If it returns 'judged', it means the DB has items and the tribunal processed them.
  const result = await truthTribunalAgent.run();
  
  console.log("\nResult:", JSON.stringify(result, null, 2));
  
  if (result.success) {
    console.log("✅ PASS: Truth Tribunal executed without crashing.");
  } else {
    console.log("❌ FAIL:", result.error);
  }
  
  process.exit(0);
}
runTest();
