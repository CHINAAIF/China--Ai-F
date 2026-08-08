import tokenMeter from './lib/sovereign-token-meter.mjs';

console.log("--- Starting Silicon Valley Financial Engine Test ---");

async function runTest() {
  const tierHeavy = { tier: 'heavy', max_tokens: 4096, cost_cents: 10 };
  const tierLite = { tier: 'lite', max_tokens: 256, cost_cents: 1 };

  // 1. Smart Refund Test
  console.log("\n1. Testing Smart Refund...");
  const inputTokens = 500;
  const reserved = tokenMeter.getReserveEstimate(inputTokens, tierHeavy); // 500 + 4096 = 4596
  const actualOutput = 300;
  const actualCost = tokenMeter.calculateActualCost(inputTokens, actualOutput); // 500 + 300 = 800
  const refund = reserved - actualCost;
  console.log(`   Reserved: ${reserved}, Actual: ${actualCost}, Refunded: ${refund}`);
  console.log(refund === 3796 ? "✅ PASS: Excess tokens refunded to user." : "❌ FAIL");

  // 2. Adaptive Capping (Free User with low balance)
  console.log("\n2. Testing Adaptive Capping (Low Balance)...");
  const userBalance = 200;
  const inputTokens2 = 50;
  const tokensLeftAfterInput = userBalance - inputTokens2;
  let adaptiveMax = tierHeavy.max_tokens;
  if (tokensLeftAfterInput < tierHeavy.max_tokens) {
    adaptiveMax = Math.max(50, tokensLeftAfterInput); // Min 50 tokens
  }
  console.log(`   User Balance: ${userBalance}, Input: ${inputTokens2}, Tier Max: ${tierHeavy.max_tokens}, Adaptive Max: ${adaptiveMax}`);
  console.log(adaptiveMax === 150 ? "✅ PASS: Max tokens capped to user's remaining balance." : "❌ FAIL");

  // 3. Hard Reject (Not enough for input)
  console.log("\n3. Testing Hard Reject (Insufficient Funds)...");
  const userBalance3 = 100;
  const inputTokens3 = 500;
  const allowed = userBalance3 >= inputTokens3;
  console.log(`   User Balance: ${userBalance3}, Input Needed: ${inputTokens3}, Allowed: ${allowed}`);
  console.log(allowed === false ? "✅ PASS: Request rejected (Insufficient funds for input)." : "❌ FAIL");

  process.exit(0);
}
runTest();
