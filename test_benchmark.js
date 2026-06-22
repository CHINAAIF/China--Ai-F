import dotenv from 'dotenv'; dotenv.config();
import { modelBenchmarkingEngine } from './agents/intelligence/model-benchmarking-engine.js';

async function test() {
  console.log('=== Model Benchmarking Engine Tests ===\n');

  console.log('--- Init ---');
  var init = await modelBenchmarkingEngine.initialize();
  console.log('initialize: ' + init + ' | status: ' + modelBenchmarkingEngine.status);

  console.log('\n--- Test 1: Single question benchmark (pricing) ---');
  var r1 = await modelBenchmarkingEngine.benchmarkQuestion(
    'ما هو سعر Groq لكل مليون توكن؟ أجب بـJSON: {price_per_1m_tokens: "...", confidence: 0-100}',
    'pricing'
  );
  console.log('  agreement: ' + r1.agreement + '%');
  console.log('  avg_confidence: ' + r1.avg_confidence);
  console.log('  models_succeeded: ' + r1.models_succeeded + '/' + r1.models_total);
  for (var mk in r1.results) {
    var m = r1.results[mk];
    console.log('  ' + mk + ': ' + (m.success ? 'conf:' + m.confidence + ' lat:' + m.latency_ms + 'ms' : 'ERROR: ' + m.error));
  }

  console.log('\n--- Test 2: Full domain benchmark (content) ---');
  var r2 = await modelBenchmarkingEngine.benchmarkDomain('content');
  if (r2.success) {
    console.log('  questions_tested: ' + r2.summary.questions_tested);
    console.log('  avg_agreement: ' + r2.summary.avg_agreement + '%');
    console.log('  avg_confidence: ' + r2.summary.avg_confidence);
    console.log('  avg_latency: ' + r2.summary.avg_latency_ms + 'ms');
  } else {
    console.log('  error: ' + r2.error);
  }

  console.log('\n--- Test 3: Rankings ---');
  var r3 = await modelBenchmarkingEngine.getRankings('pricing');
  if (r3.success) {
    console.log('  pricing domain rankings:');
    r3.rankings.forEach(function(r, i) {
      console.log('    #' + (i + 1) + ' ' + r.model_key + ' | acc:' + r.accuracy_score + ' | samples:' + r.sample_count + ' | lat:' + r.avg_latency_ms + 'ms');
    });
  }

  console.log('\n--- Test 4: Diagnostic ---');
  var r4 = await modelBenchmarkingEngine.runDiagnostic();
  console.log('  ' + JSON.stringify(r4, null, 2));

  console.log('\nDone');
}
test().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
