import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';

async function fix() {
  var el = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');

  // Add safety fallback INSIDE writeRoutingDecision - if requestHash is null, compute it
  var oldParams = 'const {\n        eventLogId, customerId, requestHash, taskType, modelSelected,';
  var newParams = 'const {\n        eventLogId, customerId, requestHash, taskType, modelSelected,';
  if (el.includes(oldParams)) {
    // Find the line after params where we can add the safety check
    var afterParams = el.indexOf('providerId, policyVersionId, agentId, causalReason, confidence,');
    if (afterParams > -1) {
      var nextLine = el.indexOf('\n', afterParams);
      var safeHash = [
        '      // Safety: if requestHash is null compute from causalReason',
        '      var safeRequestHash = requestHash || crypto.createHash("sha256").update(JSON.stringify(causalReason || taskType || "unknown"), "utf8").digest("hex").substring(0, 32);'
      ].join('\n');
      el = el.substring(0, nextLine + 1) + safeHash + '\n' + el.substring(nextLine + 1);
    }
  }

  // Replace requestHash with safeRequestHash in the INSERT
  el = el.replace('requestHash,', 'safeRequestHash,');
  // But be careful not to replace in the params destructuring - only in VALUES
  // Actually let's be more precise
  el = el.replace(
    '[$1,\n          eventLogId, customerId, requestHash, taskType',
    '[$1,\n          eventLogId, customerId, safeRequestHash, taskType'
  );

  fs.writeFileSync(HOME + '/agents/governance/execution-layer.js', el, 'utf8');
  console.log('OK: added safeRequestHash fallback inside writeRoutingDecision');

  // Now write a COMPLETE standalone test that imports fresh
  console.log('\nWriting standalone test...');
  var testCode = [
    'import dotenv from "dotenv"; dotenv.config();',
    'import pg from "pg";',
    'import crypto from "crypto";',
    'const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });',
    '',
    'async function test() {',
    '  // Read the source file directly and eval to bypass cache',
    '  var el = await import("./agents/governance/execution-layer.js?final=" + Date.now());',
    '  var layer = el.executionLayer;',
    '  await layer.initialize();',
    '',
    '  var n = "final-" + crypto.randomUUID();',
    '  var s = crypto.createHash("sha256").update(n).digest("hex").substring(0, 32);',
    '  var c = await pool.query(',
    '    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL \'30 seconds\',false,NOW()) RETURNING id",',
    '    [n, "hfinal", s]',
    '  );',
    '  var r = await layer.execute({',
    '    id: c.rows[0].id, nonce: n, signature: s,',
    '    task_type: "general_query", intent: "نهائي", agent_id: "final_test"',
    '  }, { question: "ما عاصمة اليابان؟ أجب بـJSON: {answer: ..., confidence: 0-100}" });',
    '  console.log("success: " + r.success);',
    '  if (r.success) console.log("confidence: " + r.metadata.confidence + " | latency: " + r.metadata.latency_ms + "ms");',
    '  else console.log("error: " + r.error);',
    '',
    '  // Check routing_decisions',
    '  var rd = await pool.query("SELECT task_type, substring(request_hash,1,20) as rh, confidence, outcome FROM routing_decisions ORDER BY created_at DESC LIMIT 1");',
    '  if (rd.rows.length > 0) {',
    '    var row = rd.rows[0];',
    '    console.log("rd: " + row.task_type + " | hash:" + row.rh + "... | conf:" + row.confidence + " | " + row.outcome);',
    '  }',
    '',
    '  // Check event_log',
    '  var ev = await pool.query("SELECT event_type, substring(payload_hash,1,20) as h FROM event_log WHERE event_type LIKE \'execution%\' ORDER BY created_at DESC LIMIT 3");',
    '  ev.rows.forEach(function(r) { console.log("ev: " + r.event_type + " | " + r.h + "..."); });',
    '',
    '  // Replay test',
    '  var r2 = await layer.execute({ id: c.rows[0].id, nonce: n, signature: s, agent_id: "final_test" }, { q: "x" });',
    '  console.log("replay blocked: " + (!r2.success));',
    '',
    '  console.log("Done");',
    '  await pool.end();',
    '}',
    'test().catch(function(e) { console.error("FATAL: " + e.message); process.exit(1); });'
  ].join('\n');

  fs.writeFileSync(HOME + '/test_final.js', testCode, 'utf8');
  console.log('OK: test_final.js written');
}
fix().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
