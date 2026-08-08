import { classifyTask } from './lib/sovereign-classifier.mjs';
import { getRoutingChain } from './lib/shadow-router.mjs';

console.log("--- Starting End-to-End Routing Flow Test ---");

async function runTest() {
  const tests = [
    { desc: "1. Civil Engineering (Heavy)", q: "Architect a structural optimization algorithm for a suspension bridge considering wind load resonance and material fatigue thresholds.", expect: "heavy" },
    { desc: "2. Casual Chat (Lite)", q: "Hey, what time is it in Tokyo right now?", expect: "lite" },
    { desc: "3. Literary Analysis (Standard)", q: "Analyze the themes of existentialism in Albert Camus novel The Stranger.", expect: "standard" }
  ];

  for (const t of tests) {
    console.log(`\n${t.desc}`);
    console.log(`   Input: "${t.q.substring(0, 50)}..."`);
    
    // 1. Classify
    const profile = classifyTask(t.q);
    console.log(`   Cognitive Profile: Tier=${profile.tier}`);
    
    // 2. Route
    const chain = getRoutingChain(profile.tier);
    console.log(`   Expected Tier: ${t.expect} -> ${profile.tier === t.expect ? "✅ PASS" : "❌ FAIL"}`);
    
    // 3. Print Failover Chain
    if (chain.length > 0) {
      console.log(`   🔗 Failover Chain:`);
      chain.forEach((p, i) => console.log(`      ${i + 1}. ${p.providerName} (${p.modelName})`));
    } else {
      console.log(`   ❌ FAIL: No providers found for tier!`);
    }
  }

  process.exit(0);
}
runTest();
