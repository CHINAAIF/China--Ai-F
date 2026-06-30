import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function test() {
  try {
    await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'tfix-%'").catch(function(){});
    await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'tfix-%'").catch(function(){});
    var { executionLayer } = await import('./agents/governance/execution-layer.js?t=' + Date.now());
    var n = 'tfix-' + crypto.randomUUID();
    var s = crypto.createHash('sha256').update(n).digest('hex').substring(0, 32);
    var c = await pool.query(
      "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id",
      [n, 'htest', s]
    );
    console.log('--- Test: valid execution ---');
    var r = await executionLayer.execute({
      id: c.rows[0].id, nonce: n, signature: s,
      task_type: 'general_query', intent: 'اختبار', agent_id: 'fix_test'
    }, { question: 'ما هو 2+2؟ أجب بـJSON: {answer: N, confidence: 0-100}' });
    console.log('success: ' + r.success);
    if (r.success) {
      console.log('confidence: ' + r.metadata.confidence + ' | latency: ' + r.metadata.latency_ms + 'ms');
      console.log('pii_masked: ' + r.metadata.pii_masked);
    } else { console.log('error: ' + r.error); }
    console.log('\n--- Test: replay rejection ---');
    var r2 = await executionLayer.execute({ id: c.rows[0].id, nonce: n, signature: s, agent_id: 'fix_test' }, { q: 'x' });
    console.log('success: ' + r2.success + ' | error: ' + r2.error);
    console.log('\n--- DB verify ---');
    var bad = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
    console.log('bad hashes: ' + bad.rows[0].c);
    var ev = await pool.query("SELECT event_type, substring(payload_hash,1,20) as h FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 4");
    ev.rows.forEach(function(r) { console.log('  ' + r.event_type + ' | ' + r.h + '...'); });
    var rd = await pool.query("SELECT task_type, confidence, outcome FROM routing_decisions ORDER BY created_at DESC LIMIT 2");
    rd.rows.forEach(function(r) { console.log('  rd: ' + r.task_type + ' | conf:' + r.confidence + ' | ' + r.outcome); });
    console.log('\nDone');
  } catch(e) { console.error('FATAL: ' + e.message); }
  await pool.end();
}
test();
