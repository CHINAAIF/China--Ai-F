// 1. Inject Dummy API Keys BEFORE importing the router
process.env.OPENAI_API_KEY = "sk-dummy-openai-key";
process.env.TOGETHER_API_KEY = "dummy-together-key";

// 2. Now import the modules
const { getRoutingChain } = await import('./lib/sovereign-router.mjs');
const { writeMemory, generateMemoryToken } = await import('./lib/blackboard.js');

console.log("--- Starting Cognitive Aware Router Test (V2) ---");

async function runTest() {
  const token = generateMemoryToken('provider_watchdog');
  
  console.log("1. Injecting Fake Health Data (Groq is dead, OpenAI is perfect)...");
  const fakeLedger = {
    groq: { score: 0, available: false, latency: 5000, failures: 3 },
    openai: { score: 100, available: true, latency: 100, failures: 0 }
  };
  await writeMemory('system:provider_trust_ledger', fakeLedger, 60, token);

  console.log("\n2. Requesting Routing Chain for 'lite' tier...");
  const chain = await getRoutingChain('lite');
  
  console.log("   Routing Chain Result:");
  chain.forEach((p, i) => console.log(`      ${i + 1}. ${p.providerName} (${p.modelName}) - Trust: ${p.trustScore}`));

  const hasGroq = chain.some(p => p.providerName === 'groq');
  const hasOpenAI = chain.some(p => p.providerName === 'openai');

  if (!hasGroq && hasOpenAI && chain[0].providerName === 'openai') {
    console.log("\n✅ PASS: Dead provider (Groq) skipped. Healthy provider (OpenAI) selected instantly!");
  } else {
    console.log("\n❌ FAIL: Router did not filter dead providers correctly.");
  }

  process.exit(0);
}
runTest();
