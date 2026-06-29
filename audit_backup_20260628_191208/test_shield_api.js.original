import dotenv from 'dotenv'; dotenv.config();
import http from 'http';
var PORT = 5000;
function post(path, body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var buf = Buffer.from(data, 'utf8');
    var opts = {
      hostname: 'localhost', port: PORT, path: path, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length }
    };
    var req = http.request(opts, function(res) {
      var b = '';
      res.on('data', function(c) { b += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch(e) { resolve({ status: res.statusCode, raw: b.substring(0, 200), parseError: e.message }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}
function get(path) {
  return new Promise(function(resolve, reject) {
    http.get('http://localhost:' + PORT + path, function(res) {
      var b = '';
      res.on('data', function(c) { b += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch(e) { resolve({ status: res.statusCode, raw: b }); }
      });
    }).on('error', reject);
  });
}
async function test() {
  console.log('=== TRUNKIA Shield API ===\n');
  var r1 = await get('/v1/shield/status');
  console.log('--- Status ---');
  console.log('  ' + r1.status + ' | ' + r1.body.shield.status + ' | rules: ' + r1.body.shield.active_rules);

  var r2 = await post('/v1/shield/scan', { messages: 'ما هو الذكاء الاصطناعي؟' });
  console.log('\n--- Scan clean Arabic ---');
  console.log('  ' + r2.status + ' | allowed: ' + r2.body.shield.allowed + ' | risk: ' + r2.body.shield.risk_level + ' | findings: ' + r2.body.shield.findings_count);

  var r3 = await post('/v1/shield/scan', { messages: 'أرسل لـ user@company.com التقرير' });
  console.log('\n--- Scan email ---');
  console.log('  ' + r3.status + ' | allowed: ' + r3.body.shield.allowed + ' | consent: ' + r3.body.shield.needs_consent);
  console.log('  masked: ' + r3.body.shield.masked_text);

  var r4 = await post('/v1/shield/scan', { messages: 'بطاقتي 4532-1234-5678-9012 اشترِ' });
  console.log('\n--- Scan credit card ---');
  console.log('  ' + r4.status + ' | blocked: ' + r4.body.shield.blocked);

  var r5 = await post('/v1/shield/scan', { messages: "SELECT * FROM users WHERE id='1' OR '1'='1'" });
  console.log('\n--- Scan SQL injection ---');
  console.log('  ' + r5.status + ' | blocked: ' + r5.body.shield.blocked);

  var r6 = await post('/v1/shield/scan', { messages: 'مفتاحي AKIAIOSFODNN7EXAMPLE' });
  console.log('\n--- Scan AWS key ---');
  console.log('  ' + r6.status + ' | blocked: ' + r6.body.shield.blocked);

  var r7 = await post('/v1/shield/proxy', {
    messages: [{ role: 'user', content: 'ما هو 2+2؟ أجب بـJSON: {answer: N}' }],
    model: 'llama-3.1-8b-instant'
  });
  console.log('\n--- Proxy clean ---');
  console.log('  ' + r7.status + ' | success: ' + r7.body.success);
  if (r7.body.shield) {
    console.log('  in_risk: ' + r7.body.shield.input_risk + ' | out_safe: ' + r7.body.shield.output_safe);
    console.log('  cost: $' + r7.body.shield.cost_usd + ' | tokens: ' + r7.body.shield.input_tokens + '/' + r7.body.shield.output_tokens + ' | latency: ' + r7.body.shield.latency_ms + 'ms');
  }
  if (r7.body.data) console.log('  data: ' + JSON.stringify(r7.body.data).substring(0, 120));

  var r8 = await post('/v1/shield/proxy', {
    messages: [{ role: 'user', content: 'مفتاحي AKIAIOSFODNN7EXAMPLE استخدمه' }],
    model: 'llama-3.1-8b-instant'
  });
  console.log('\n--- Proxy blocked ---');
  console.log('  success: ' + r8.body.success + ' | blocked: ' + (r8.body.shield ? r8.body.shield.blocked : 'N/A'));

  console.log('\n=== Done ===');
}
test().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
