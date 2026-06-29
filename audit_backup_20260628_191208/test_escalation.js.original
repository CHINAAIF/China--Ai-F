import dotenv from 'dotenv'; dotenv.config();
import { safeGroqJSON } from './agents/utils/safe-json.js';

async function test() {
  console.log('=== Escalation Engine Tests ===\n');

  // Test 1: High confidence (>=80) — no escalation
  console.log('--- Test 1: High confidence (>=80) — no escalation expected ---');
  var r1 = await safeGroqJSON('ما هو 2+2؟ أجب بـJSON: {answer: 4, confidence: 95}', null, 'test_escalation');
  console.log('  success: ' + r1.success + ' | model: ' + r1.model);
  console.log('  confidence: ' + r1.data.confidence + ' | escalation: ' + JSON.stringify(r1.escalation));
  console.log('  _escalated: ' + r1.data._escalated);

  // Test 2: Medium confidence (60-79) — light escalation
  console.log('\n--- Test 2: Medium confidence (60-79) — light escalation ---');
  var r2 = await safeGroqJSON('قارن GPT-4 و Claude بأقل من 80 ثقة. أجب بـJSON: {comparison: "...", confidence: 65}', null, 'test_escalation');
  console.log('  success: ' + r2.success + ' | model: ' + r2.model);
  console.log('  original_confidence: ' + r2.data._original_confidence + ' | final: ' + r2.data.confidence);
  if (r2.escalation) {
    console.log('  tier: ' + r2.escalation.tier + ' | agreement: ' + r2.escalation.agreement);
  }

  // Test 3: Financial — always consensus
  console.log('\n--- Test 3: Financial task — consensus escalation always ---');
  var r3 = await safeGroqJSON('ما هو توقع سعر سهم شركة Apple الأسبوع القادم؟ أجب بـJSON: {prediction: "...", confidence: 70}', null, 'test_escalation');
  console.log('  success: ' + r3.success + ' | model: ' + r3.model);
  console.log('  final confidence: ' + r3.data.confidence);
  if (r3.escalation) {
    console.log('  tier: ' + r3.escalation.tier + ' | agreement: ' + r3.escalation.agreement);
    console.log('  needs_sovereign_review: ' + r3.escalation.needs_sovereign_review);
  }

  // Test 4: Strategic — always consensus
  console.log('\n--- Test 4: Strategic task — consensus escalation always ---');
  var r4 = await safeGroqJSON('ما هي أفضل استراتيجية دخول سوق AI الصيني؟ أجب بـJSON: {strategy: "...", confidence: 60}', null, 'test_escalation');
  console.log('  success: ' + r4.success + ' | model: ' + r4.model);
  if (r4.escalation) {
    console.log('  tier: ' + r4.escalation.tier + ' | agreement: ' + r4.escalation.agreement);
    console.log('  needs_sovereign_review: ' + r4.escalation.needs_sovereign_review);
  }

  // Test 5: Low confidence (<40) — dual verification
  console.log('\n--- Test 5: Low confidence (<40) — dual verification ---');
  var r5 = await safeGroqJSON('ما هو لون السماء على كوكب المريخ غداً؟ أجب بـJSON: {answer: "...", confidence: 25}', null, 'test_escalation');
  console.log('  success: ' + r5.success + ' | model: ' + r5.model);
  console.log('  original_confidence: ' + r5.data._original_confidence + ' | final: ' + r5.data.confidence);
  if (r5.escalation) {
    console.log('  tier: ' + r5.escalation.tier + ' | models: ' + JSON.stringify(r5.escalation.models));
    console.log('  avg_agreement: ' + r5.escalation.avg_agreement);
  }

  console.log('\n=== Done ===');
}
test().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
