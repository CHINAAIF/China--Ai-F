import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';

async function fix() {
  // =============================================
  // 1. Fix execution-layer.js
  // =============================================
  console.log('Fixing execution-layer.js...');
  var el = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');

  // Fix provider_id
  el = el.replace('let providerId = provider;', 'let providerId = null;');

  // Replace entire writeEventLog - find by signature
  var oldStart = el.indexOf('async writeEventLog(eventType, agentId, customerId, payload, policyVersionId)');
  if (oldStart === -1) { console.log('WARN: writeEventLog not found in execution-layer'); }
  else {
    var oldEnd = el.indexOf('async writeRoutingDecision(', oldStart);
    if (oldEnd === -1) { console.log('WARN: writeRoutingDecision not found'); }
    else {
      var newMethod = [
        'async writeEventLog(eventType, agentId, customerId, payload, policyVersionId) {',
        '    try {',
        '      // Rule: event_log_no_update blocks ALL updates - compute hash BEFORE insert',
        '      var payloadStr = JSON.stringify(payload);',
        '      var hash = crypto.createHash("sha256").update(payloadStr, "utf8").digest("hex");',
        '      var insertResult = await pool.query(',
        '        "INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash, policy_version_id, created_at) VALUES ($1,$2,$3,$4::jsonb,$5,NOW()) RETURNING id",',
        '        [eventType, agentId, customerId, payloadStr, hash, policyVersionId]',
        '      );',
        '      return insertResult.rows[0].id;',
        '    } catch (e) {',
        '      console.error("[execution-layer] event_log error: " + e.message);',
        '      return null;',
        '    }',
        '  }',
        ''
      ].join('\n');
      el = el.substring(0, oldStart) + newMethod + el.substring(oldEnd);
      console.log('  OK: writeEventLog patched - hash before INSERT, no UPDATE');
    }
  }
  fs.writeFileSync(HOME + '/agents/governance/execution-layer.js', el, 'utf8');

  // =============================================
  // 2. Fix advisor-layer.js
  // =============================================
  console.log('\nFixing advisor-layer.js...');
  var al = fs.readFileSync(HOME + '/agents/governance/advisor-layer.js', 'utf8');

  // Find the event_log INSERT pattern: VALUES ($1,$2,$3,$4,'pending') RETURNING id
  var alInsertIdx = al.indexOf("'pending') RETURNING id");
  if (alInsertIdx === -1) {
    console.log('  advisor-layer: pending pattern not found, checking if already fixed...');
    if (al.indexOf('crypto.createHash') > -1 && al.indexOf('event_log_no_update') === -1) {
      console.log('  already uses crypto.hash, checking if still has pending...');
    }
  } else {
    // Find the start of this INSERT block
    var lineStart = al.lastIndexOf('\n', alInsertIdx);
    // Replace from the INSERT line to include the whole block up to the hash UPDATE
    // Pattern: INSERT INTO event_log ... VALUES ($1,$2,$3,$4,'pending') RETURNING id
    // Then: const logId = ...
    // Then: hash computation
    // Then: UPDATE event_log SET payload_hash=...
    // Then: SELECT payload_hash ...
    // Then: if verify === 'pending' throw

    // Find the UPDATE line
    var updateIdx = al.indexOf("'UPDATE event_log SET payload_hash=$1, signature=$2 WHERE id=$3'", alInsertIdx);
    if (updateIdx === -1) {
      console.log('  WARN: UPDATE pattern not found in advisor-layer');
    } else {
      // Find end of the verify block (the throw line)
      var throwIdx = al.indexOf("throw new Error('hash_update_failed')", updateIdx);
      if (throwIdx === -1) {
        console.log('  WARN: throw pattern not found');
      } else {
        // Find end of that line
        var throwEnd = al.indexOf('\n', throwIdx);
        if (throwEnd === -1) throwEnd = al.length;

        // Now find start: go back from the INSERT to find the const/logId line or pool.query line
        var insertBlockStart = al.lastIndexOf('await pool.query(', alInsertIdx);
        // Go back one more line to find the variable assignment
        var varLineStart = al.lastIndexOf('\n', insertBlockStart - 1);
        if (varLineStart === -1) varLineStart = 0; else varLineStart++;

        var newBlock = [
          '      // Rule: event_log_no_update blocks ALL updates - compute hash BEFORE insert',
          '      var payloadStr = JSON.stringify(payloadObj);',
          '      var evtHash = crypto.createHash("sha256").update(payloadStr, "utf8").digest("hex");',
          '      var logResult = await pool.query(',
          '        "INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id",',
          '        [evtType, agentId, customerId, payloadStr, evtHash]',
          '      );',
          '      var logId = logResult.rows[0].id;'
        ].join('\n');

        al = al.substring(0, varLineStart) + newBlock + '\n' + al.substring(throwEnd + 1);
        console.log('  OK: advisor-layer patched - hash before INSERT, no UPDATE');
      }
    }
  }
  fs.writeFileSync(HOME + '/agents/governance/advisor-layer.js', al, 'utf8');

  // =============================================
  // 3. Verify no more pending/computing in code
  // =============================================
  console.log('\nVerifying...');
  var el2 = fs.readFileSync(HOME + '/agents/governance/execution-layer.js', 'utf8');
  var al2 = fs.readFileSync(HOME + '/agents/governance/advisor-layer.js', 'utf8');
  console.log('  execution-layer has computing: ' + el2.includes("'computing'"));
  console.log('  execution-layer has pending: ' + (el2.includes("'pending'") && !el2.includes('pending...')));
  console.log('  advisor-layer has pending INSERT: ' + al2.includes("'pending') RETURNING id"));
  console.log('  advisor-layer has hash_update_failed: ' + al2.includes('hash_update_failed'));

  // =============================================
  // 4. Test execution-layer fresh
  // =============================================
  console.log('\nTesting execution-layer...');
  await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'finalt-%'").catch(function(){});
  await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'finalt-%'").catch(function(){});

  var { executionLayer } = await import('./agents/governance/execution-layer.js?r=' + Date.now());

  var n = 'finalt-' + crypto.randomUUID();
  var s = crypto.createHash('sha256').update(n).digest('hex').substring(0, 32);
  var c = await pool.query(
    "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at) VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id",
    [n, 'hfinal', s]
  );

  var r = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s,
    task_type: 'general_query', intent: 'اختبار نهائي', agent_id: 'final_test'
  }, { question: 'ما هو 3+3؟ أجب بـJSON: {answer: N, confidence: 0-100}' });

  console.log('  success: ' + r.success);
  if (r.success) {
    console.log('  confidence: ' + r.metadata.confidence + ' | latency: ' + r.metadata.latency_ms + 'ms');
  } else { console.log('  error: ' + r.error); }

  // Replay test
  var r2 = await executionLayer.execute({
    id: c.rows[0].id, nonce: n, signature: s, agent_id: 'final_test'
  }, { q: 'replay' });
  console.log('  replay blocked: ' + (!r2.success && r2.error === 'contract_already_used'));

  // Verify hashes
  var bad = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
  console.log('\n  bad hashes in DB: ' + bad.rows[0].c);

  var last = await pool.query("SELECT event_type, substring(payload_hash,1,24) as h FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 4");
  console.log('  last execution event_log hashes:');
  last.rows.forEach(function(row) { console.log('    ' + row.event_type + ' | ' + row.h + '...'); });

  console.log('\nDone');
  await pool.end();
}
fix().catch(function(e) { console.error('FATAL: ' + e.message); process.exit(1); });
