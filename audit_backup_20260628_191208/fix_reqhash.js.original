import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';

async function fix() {
  console.log('Fixing request_hash in execution-layer.js...');
  var el = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');

  // The problem: contract.content_hash is undefined because caller doesn't pass it
  // Solution: compute from requestPayload directly
  el = el.replace(
    'requestHash: contract.content_hash || crypto.createHash("sha256").update(JSON.stringify(requestPayload), "utf8").digest("hex").substring(0, 32),',
    'requestHash: crypto.createHash("sha256").update(JSON.stringify(requestPayload), "utf8").digest("hex").substring(0, 32),'
  );

  fs.writeFileSync(HOME + '/agents/governance/execution-layer.js', el, 'utf8');
  console.log('  OK: request_hash computed from requestPayload directly');

  // Test
  console.log('\nTesting...');
  await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'rh-%'").catch(function(){});
  await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'rh-%'").catch(function(){});

  var { executionLayer } = await import('./agents/governance/execution-layer.js?rh=' + Date.now());
  var n = 'rh-' + crypto.randomUUID();
  var s = crypto.createHash('sha256').update(n).digest('hex').substring(0, 32);
  var c = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id",
    [n, 'hrh', s]
  );
  var r = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s,
    task_type: 'general_query', intent: 'اختبار hash', agent_id: 'rh_test'
  }, { question: 'ما عاصمة فرنسا؟ أجب بـJSON: {answer: "...", confidence: 0-100}' });

  console.log('  success: ' + r.success);
  if (r.success) {
    console.log('  confidence: ' + r.metadata.confidence + ' | latency: ' + r.metadata.latency_ms + 'ms');
  } else { console.log('  error: ' + r.error); }

  // Check routing_decisions
  var rd = await pool.query("SELECT id, task_type, request_hash, confidence, outcome FROM routing_decisions ORDER BY created_at DESC LIMIT 1");
  if (rd.rows.length > 0) {
    var row = rd.rows[0];
    console.log('\n  routing_decisions last row:');
    console.log('    task: ' + row.task_type);
    console.log('    request_hash: ' + (row.request_hash ? row.request_hash.substring(0, 24) + '... OK' : 'NULL BAD'));
    console.log('    confidence: ' + row.confidence + ' | outcome: ' + row.outcome);
  }

  // Check event_log for this execution
  var ev = await pool.query("SELECT event_type, payload_hash FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 3");
  console.log('\n  event_log last 3:');
  ev.rows.forEach(function(row) {
    var ok = row.payload_hash !== 'computing' && row.payload_hash !== 'pending' && row.payload_hash !== 'pending...';
    console.log('    ' + row.event_type + ' | ' + row.payload_hash.substring(0, 20) + '... ' + (ok ? 'OK' : 'BAD'));
  });

  console.log('\nDone');
  await pool.end();
}
fix().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
