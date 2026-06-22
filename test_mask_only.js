import dotenv from 'dotenv'; dotenv.config();
import { safetyComplianceLayer } from './agents/governance/safety-compliance-layer.js';
async function test() {
  await safetyComplianceLayer.initialize();
  var tests = [
    ['email', 'أرسل لـ user@company.com و admin@secret.org'],
    ['credit', 'بطاقتي 4532-1234-5678-9012'],
    ['national_id', 'رقم هويتي SA1234567890'],
    ['phone', 'هاتفي 051-234-5678'],
    ['ip', 'عنواني 192.168.1.100'],
    ['mixed', 'بريدي test@mail.com وبطاقتي 4532-1234-5678-9012 وهاتفي 051-234-5678']
  ];
  for (var i = 0; i < tests.length; i++) {
    var r = await safetyComplianceLayer.scanAndDecide(tests[i][1], 'mask_test');
    console.log(tests[i][0] + ': ' + r.masked_text);
  }
}
test().catch(function(e) { console.error(e.message); });
