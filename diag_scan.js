import http from 'http';
function post(path, body) {
  return new Promise(function(resolve) {
    var data = JSON.stringify(body);
    var req = http.request({ hostname:'localhost', port:5000, path:path, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':data.length} }, function(res) {
      var b = '';
      res.on('data', function(c) { b += c; });
      res.on('end', function() {
        try { resolve({ status:res.statusCode, body:JSON.parse(b) }); }
        catch(e) { resolve({ status:res.statusCode, raw:b, parseError:e.message }); }
      });
    });
    req.on('error', function(e) { resolve({ error:e.message }); });
    req.write(data);
    req.end();
  });
}
async function diag() {
  console.log('Test 1: ASCII text');
  var r1 = await post('/v1/shield/scan', { messages: 'hello world' });
  console.log('  status: ' + r1.status);
  console.log('  body: ' + JSON.stringify(r1).substring(0, 300));

  console.log('\nTest 2: Arabic text');
  var r2 = await post('/v1/shield/scan', { messages: 'ما هو الذكاء الاصطناعي' });
  console.log('  status: ' + r2.status);
  console.log('  body: ' + JSON.stringify(r2).substring(0, 300));

  console.log('\nTest 3: email');
  var r3 = await post('/v1/shield/scan', { text: 'user@test.com' });
  console.log('  status: ' + r3.status);
  console.log('  body: ' + JSON.stringify(r3).substring(0, 300));
}
diag().catch(function(e) { console.error('FATAL: ' + e.message); });
