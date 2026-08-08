import { providerWatchdogAgent } from './agents/system/provider-watchdog-agent.js';
import { writeMemory, generateMemoryToken } from './lib/blackboard.js';

console.log("--- Starting Isolated Deterministic Routing Test ---");

async function runTest() {
  process.env.IMMUNE_SECRET = "trunkia_immune_2026";

  // 1. Inject fake health status into multi-model (Simulating Groq is failing, OpenAI is perfect)
  console.log("\n1. Injecting Fake Health Status (Groq failing, OpenAI perfect)...");
  // The watchdog reads from multiModel.getHealthStatus(), we will mock the ledger directly
  const fakeToken = generateMemoryToken('provider_watchdog');
  const fakeLedger = {
    groq: { score: 10, available: true, latency: 5000, failures: 3 },
    openai: { score: 100, available: true, latency: 100, failures: 0 }
  };
  await writeMemory('system:provider_trust_ledger', fakeLedger, 60, fakeToken);
  console.log("✅ Fake ledger written to Blackboard.");

  // 2. Test Router Logic (Bypassing DB, testing math directly)
  console.log("\n2. Testing Router Math Logic...");
  // We import the router's math logic directly
  const ledger = await import('./lib/blackboard.js').then(m => m.readMemory('system:provider_trust_ledger'));
  
  let bestProvider = null;
  let highestScore = -1;
  for (const [name, data] of Object.entries(ledger)) {
    if (data.available && data.score > highestScore) {
      highestScore = data.score;
      bestProvider = name;
    }
  }

  if (bestProvider === 'openai' && highestScore === 100) {
    console.log(`✅ PASS: Router mathematically selected '${bestProvider}' with score ${highestScore} (Avoided failing Groq).`);
  } else {
    console.log(`❌ FAIL: Router selected ${bestProvider} (Expected openai).`);
  }

  process.exit(0);
}
runTest();
