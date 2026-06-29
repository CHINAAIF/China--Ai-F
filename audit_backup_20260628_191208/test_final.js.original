import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function test() {
  await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'clean-%'").catch(function(){});
  await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'clean-%'").catch(function(){});
  var { executionLayer } = await import('./agents/governance/execution-layer.js?clean=' + Date.now());
  var n = 'clean-' + crypto.randomUUID();
  var s = crypto.createHash('sha256').update(n).digest('hex').substring(0, 32);
  var c = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id",
    [n, 'hclean', s]
  );
  console.log('--- Test: valid execution ---');
  var r = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s,
    task_type: 'general_query', intent: 'اختبار نظيف', agent_id: 'clean_test'
  }, { question: 'ما عاصمة ألمانيا؟ أجب بـJSON: {answer: "...", confidence: 0-100}' });
  console.log('success: ' + r.success);
  if (r.success) {
    console.log('confidence: ' + r.metadata.confidence + ' | latency: ' + r.metadata.latency_ms + 'ms');
    console.log('pii_masked: ' + r.metadata.pii_masked + ' | byok: ' + r.metadata.byok_used);
  } else { console.log('error: ' + r.error); }
  console.log('\n--- Test: replay blocked ---');
  var r2 = await executionLayer.execute({ id: c.rows[0].id, nonce: n, signature: s, agent_id: 'clean_test' }, { q: 'x' });
  console.log('blocked: ' + (!r2.success && r2.error === 'contract_already_used'));
  console.log('\n--- Test: expired blocked ---');
  var n3 = 'clean-' + crypto.randomUUID();
  var s3 = crypto.createHash('sha256').update(n3).digest('hex').substring(0, 32);
  var c3 = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()-INTERVAL '1 hour',false,NOW()) RETURNING id",
    [n3, 'hexp', s3]
  );
  var r3 = await executionLayer.execute({ id: c3.rows[0].id, nonce: n3, signature: s3 }, { q: 'x' });
  console.log('blocked: ' + (!r3.success && r3.error === 'contract_expired'));
  console.log('\n--- DB Verify ---');
  var ev = await pool.query("SELECT event_type, substring(payload_hash,1,20) as h FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 4");
  ev.rows.forEach(function(row) {
    var ok = row.h !== 'computing...' && !row.h.startsWith('pending');
    console.log('  ev: ' + row.event_type + ' | ' + row.h + '... ' + (ok ? 'OK' : 'BAD'));
  });
  var rd = await pool.query("SELECT task_type, substring(request_hash,1,20) as rh, confidence, outcome FROM routing_decisions ORDER BY created_at DESC LIMIT 1");
  if (rd.rows.length > 0) {
    var row = rd.rows[0];
    console.log('  rd: ' + row.task_type + ' | hash:' + row.rh + '... | conf:' + row.confidence + ' | ' + row.outcome);
  }
  console.log('\nDone');
  await pool.end();
}
test().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
