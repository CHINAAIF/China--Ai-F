import dotenv from 'dotenv'; dotenv.config();
import { safetyComplianceLayer } from './agents/governance/safety-compliance-layer.js';

async function test() {
  console.log('=== Safety & Compliance Layer Tests ===\n');

  console.log('--- Init ---');
  var init = await safetyComplianceLayer.initialize();
  console.log('initialize: ' + init + ' | status: ' + safetyComplianceLayer.status);

  console.log('\n--- Test 1: Clean text (low risk) ---');
  var r1 = await safetyComplianceLayer.scanAndDecide('ما هو الذكاء الاصطناعي؟ أجب باختصار', 'test_agent');
  console.log('  allowed: ' + r1.allowed + ' | blocked: ' + r1.blocked);
  console.log('  privacy risk: ' + r1.checks.privacy.risk_level + ' | pii: ' + r1.checks.privacy.pii_detected);

  console.log('\n--- Test 2: Email PII (medium risk) ---');
  var r2 = await safetyComplianceLayer.scanAndDecide('أرسل تقريراً لـ user@company.com و admin@secret.org', 'test_agent');
  console.log('  allowed: ' + r2.allowed + ' | blocked: ' + r2.blocked);
  console.log('  privacy risk: ' + r2.checks.privacy.risk_level + ' | pii: ' + r2.checks.privacy.pii_detected);
  console.log('  masked: ' + r2.masked_text);
  console.log('  gdpr passed: ' + r2.checks.gdpr.passed);

  console.log('\n--- Test 3: Credit card + national ID (critical — should block) ---');
  var r3 = await safetyComplianceLayer.scanAndDecide('بطاقتي 4532-1234-5678-9012 ورقم هويتي SA1234567890', 'test_agent');
  console.log('  allowed: ' + r3.allowed + ' | blocked: ' + r3.blocked);
  console.log('  privacy risk: ' + r3.checks.privacy.risk_level + ' | pii: ' + r3.checks.privacy.pii_detected);
  console.log('  masked: ' + r3.masked_text);

  console.log('\n--- Test 4: Government classified (critical) ---');
  var r4 = await safetyComplianceLayer.scanAndDecide('هذا المستند classified ويتطلب clearance أعلى', 'test_agent');
  console.log('  allowed: ' + r4.allowed + ' | blocked: ' + r4.blocked);
  console.log('  privacy risk: ' + r4.checks.privacy.risk_level);
  console.log('  gdpr passed: ' + r4.checks.gdpr.passed);
  if (r4.checks.gdpr.violations.length > 0) {
    console.log('  gdpr violations: ' + JSON.stringify(r4.checks.gdpr.violations));
  }

  console.log('\n--- Test 5: Stats ---');
  var r5 = await safetyComplianceLayer.getStats();
  console.log('  total_checks: ' + r5.total_checks + ' | failed: ' + r5.failed_checks);
  console.log('  critical_privacy: ' + r5.critical_privacy + ' | incidents: ' + r5.total_incidents);
  console.log('  risk_distribution: ' + JSON.stringify(r5.risk_distribution));

  console.log('\n--- Test 6: Diagnostic ---');
  var r6 = await safetyComplianceLayer.runDiagnostic();
  console.log('  ' + JSON.stringify(r6, null, 2));

  console.log('\nDone');
}
test().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
