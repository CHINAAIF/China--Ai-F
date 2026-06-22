import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';

async function fix() {
  // =============================================
  // 1. Fix execution-layer.js - column count + request_hash
  // =============================================
  console.log('Fixing execution-layer.js...');
  var el = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');

  // Fix 1: SQL column count - add $6 for policy_version_id
  el = el.replace(
    'VALUES ($1,$2,$3,$4::jsonb,$5,NOW()) RETURNING id"',
    'VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW()) RETURNING id"'
  );
  console.log('  Fixed SQL column count: $5,$6,NOW()');

  // Fix 2: request_hash - compute from payload if contract.content_hash missing
  var oldHashLine = 'requestHash: contract.content_hash,';
  var newHashLine = 'requestHash: contract.content_hash || crypto.createHash("sha256").update(JSON.stringify(requestPayload), "utf8").digest("hex").substring(0, 32),';
  if (el.includes(oldHashLine)) {
    el = el.replace(oldHashLine, newHashLine);
    console.log('  Fixed request_hash fallback');
  } else {
    console.log('  WARN: requestHash line not found, searching...');
    var idx = el.indexOf('requestHash:');
    if (idx > -1) {
      console.log('  Found at: ' + el.substring(idx, idx + 80));
    }
  }

  fs.writeFileSync(HOME + '/agents/governance/execution-layer.js', el, 'utf8');

  // =============================================
  // 2. Verify fix
  // =============================================
  var el2 = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');
  console.log('\nVerify:');
  console.log('  has $6,NOW(): ' + el2.includes('$6,NOW()'));
  console.log('  has request_hash fallback: ' + el2.includes('contract.content_hash || crypto.createHash'));

  // =============================================
  // 3. Clean test data + test
  // =============================================
  console.log('\nTesting...');
  await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'v3t-%'").catch(function(){});
  await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'v3t-%'").catch(function(){});

  var { executionLayer } = await import('./agents/governance/execution-layer.js?v3=' + Date.now());

  var n = 'v3t-' + crypto.randomUUID();
  var s = crypto.createHash('sha256').update(n).digest('hex').substring(0, 32);
  var c = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id",
    [n, 'hv3', s]
  );

  var r = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s,
    task_type: 'general_query', intent: 'اختبار v3', agent_id: 'v3_test'
  }, { question: 'ما هو 5+5؟ أجب بـJSON: {answer: N, confidence: 0-100}' });

  console.log('  success: ' + r.success);
  if (r.success) {
    console.log('  confidence: ' + r.metadata.confidence + ' | latency: ' + r.metadata.latency_ms + 'ms');
    console.log('  tokens: ' + r.metadata.tokens_in + '/' + r.metadata.tokens_out);
  } else { console.log('  error: ' + r.error); }

  // Replay
  var r2 = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s, agent_id: 'v3_test'
  }, { q: 'x' });
  console.log('  replay blocked: ' + (!r2.success));

  // Expired
  var n3 = 'v3t-' + crypto.randomUUID();
  var s3 = crypto.createHash('sha256').update(n3).digest('hex').substring(0, 32);
  var c3 = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()-INTERVAL '1 hour',false,NOW()) RETURNING id",
    [n3, 'hv3e', s3]
  );
  var r3 = await executionLayer.execute({ id: c3.rows[0].id, nonce: n3, signature: s3 }, { q: 'x' });
  console.log('  expired blocked: ' + (!r3.success && r3.error === 'contract_expired'));

  // =============================================
  // 4. DB verify
  // =============================================
  console.log('\nDB verify:');
  var lastEv = await pool.query("SELECT event_type, substring(payload_hash,1,24) as h FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 6");
  var goodHash = 0, badHash = 0;
  lastEv.rows.forEach(function(row) {
    var isBad = row.h === 'computing...' || row.h.startsWith('pending');
    if (isBad) badHash++; else goodHash++;
    console.log('  ' + row.event_type + ' | ' + row.h + (isBad ? ' BAD' : ' OK'));
  });
  console.log('  new entries: ' + goodHash + ' good, ' + badHash + ' bad');

  var lastRd = await pool.query("SELECT task_type, confidence, outcome, latency_ms FROM routing_decisions ORDER BY created_at DESC LIMIT 2");
  lastRd.rows.forEach(function(row) {
    console.log('  rd: ' + row.task_type + ' | conf:' + row.confidence + ' | ' + row.outcome + ' | ' + row.latency_ms + 'ms');
  });

  var totalBad = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
  console.log('  total bad hashes in DB: ' + totalBad.rows[0].c + ' (old entries, cannot UPDATE due to rule)');

  console.log('\nDone');
  await pool.end();
}
fix().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
