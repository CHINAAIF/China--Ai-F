import { classifyTask } from './lib/sovereign-classifier.mjs';

console.log("--- Starting Cognitive Intent Matrix Test ---");

async function runTest() {
  // 1. Short Medical (Must be Heavy)
  const q1 = "I have chest pain and shortness of breath.";
  const c1 = classifyTask(q1);
  console.log(`\n1. Medical: "${q1}" -> ${c1}`);
  console.log(c1 === 'heavy' ? "✅ PASS" : "❌ FAIL (Expected heavy)");

  // 2. Short Math (Must be Heavy)
  const q2 = "What is the integral of x^2?";
  const c2 = classifyTask(q2);
  console.log(`\n2. Math: "${q2}" -> ${c2}`);
  console.log(c2 === 'heavy' ? "✅ PASS" : "❌ FAIL (Expected heavy)");

  // 3. Agent JSON Wrapper (Must be Lite)
  const q3 = '{"prompt": "What is the capital of France?", "agent": "researcher"}';
  const c3 = classifyTask(q3);
  console.log(`\n3. Agent JSON: "${q3}" -> ${c3}`);
  console.log(c3 === 'lite' ? "✅ PASS" : "❌ FAIL (Expected lite)");

  // 4. Simple Question (Must be Lite)
  const q4 = "What is the capital of France?";
  const c4 = classifyTask(q4);
  console.log(`\n4. Simple: "${q4}" -> ${c4}`);
  console.log(c4 === 'lite' ? "✅ PASS" : "❌ FAIL (Expected lite)");

  // 5. Analytical Essay (Must be Standard)
  const q5 = "Analyze the geopolitical implications of the recent semiconductor export restrictions on bilateral trade relations.";
  const c5 = classifyTask(q5);
  console.log(`\n5. Analytical: "${q5.substring(0,30)}..." -> ${c5}`);
  console.log(c5 === 'standard' ? "✅ PASS" : "❌ FAIL (Expected standard)");

  process.exit(0);
}
runTest();
