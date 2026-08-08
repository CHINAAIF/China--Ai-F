import { classifyTask } from './lib/sovereign-classifier.mjs';

console.log("--- Starting Cognitive Relativity Test (Unseen Domains) ---");

async function runTest() {
  const tests = [
    { desc: "1. Quantum Chemistry (Heavy)", q: "Derive the Schrödinger equation for a particle in a one-dimensional box and calculate the eigenvalues. H = - (ℏ^2 / 2m) d^2/dx^2 + V(x)", expect: "heavy" },
    { desc: "2. Civil Engineering (Heavy)", q: "Architect a structural optimization algorithm for a suspension bridge considering wind load resonance and material fatigue thresholds.", expect: "heavy" },
    { desc: "3. Casual Chat (Lite)", q: "Hey, what time is it in Tokyo right now?", expect: "lite" },
    { desc: "4. Simple Fact (Lite)", q: "Who wrote the play Hamlet?", expect: "lite" },
    { desc: "5. Literary Analysis (Standard)", q: "Analyze the themes of existentialism in Albert Camus' novel The Stranger.", expect: "standard" }
  ];

  let passCount = 0;
  for (const t of tests) {
    const c = classifyTask(t.q);
    const pass = c === t.expect;
    if (pass) passCount++;
    console.log(`\n${t.desc}`);
    console.log(`   Input: "${t.q.substring(0, 50)}..."`);
    console.log(`   Expected: ${t.expect} | Got: ${c} -> ${pass ? "✅ PASS" : "❌ FAIL"}`);
  }

  console.log(`\n=== Results: ${passCount}/${tests.length} Passed ===`);
  process.exit(0);
}
runTest();
