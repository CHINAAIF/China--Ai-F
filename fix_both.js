import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });

async function fix() {
  try {
    // ============================================
    // PHASE 1: Fix all bad hashes in event_log
    // ============================================
    console.log('🔧 PHASE 1: Fixing bad hashes...');
    const bad = await pool.query(
      "SELECT id, payload::text as raw_text FROM event_log WHERE payload_hash IN ('pending','pending...','computing') ORDER BY created_at"
    );
    console.log(`  found ${bad.rows.length} bad entries`);
    let fixed = 0;
    for (const row of bad.rows) {
      try {
        const hash = crypto.createHash('sha256').update(row.raw_text, 'utf8').digest('hex');
        const up = await pool.query('UPDATE event_log SET payload_hash=$1 WHERE id=$2 AND payload_hash=$3', [hash, row.id, row.payload_hash]);
        if (up.rowCount > 0) fixed++;
      } catch(e) { /* skip */ }
    }
    console.log(`  fixed: ${fixed}`);

    // Verify
    const rem = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
    console.log(`  remaining: ${rem.rows[0].c}`);

    // ============================================
    // PHASE 2: Fix provider_id in execution-layer.js
    // ============================================
    console.log('\n🔧 PHASE 2: Fixing provider_id type in execution-layer.js...');
    const elPath = '/data/data/com.termux/files/home/downloads/China--Ai-F/agents/governance/execution-layer.js';
    let el = fs.readFileSync(elPath, 'utf8');

    // Fix 1: providerId is a string name, but DB column is UUID — pass NULL
    el = el.replace(
      "let providerId = provider;",
      "let providerId = null; // DB column is UUID type, provider name tracked in causal_reason"
    );

    // Fix 2: Write the actual hash fix — the bug is the UPDATE WHERE clause matches old value but something races
    // Replace the entire writeEventLog method with a bulletproof version
    const oldMethod = `async writeEventLog(eventType, agentId, customerId, payload, policyVersionId) {
    try {
      // INSERT without hash first (payload_hash is NOT NULL so use placeholder)
      const insertResult = await pool.query(
        \`INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash, policy_version_id, created_at)
         VALUES ($1,$2,$3,$4,'computing',$5,NOW()) RETURNING id\`,
        [eventType, agentId, customerId, JSON.stringify(payload), policyVersionId]
      );
      const logId = insertResult.rows[0].id;

      // SELECT the raw text back from DB (pg jsonb ordering)
      const selectResult = await pool.query(
        'SELECT payload::text as raw_text FROM event_log WHERE id=$1',
        [logId]
      );
      const rawText = selectResult.rows[0].raw_text;

      // Compute hash on DB-ordered text
      const hash = await computePayloadHash(rawText);

      // UPDATE with real hash
      await pool.query(
        'UPDATE event_log SET payload_hash=$1 WHERE id=$2',
        [hash, logId]
      );

      // Verify
      const verify = await pool.query(
        'SELECT payload_hash FROM event_log WHERE id=$1',
        [logId]
      );
      if (verify.rows[0].payload_hash === 'computing' || verify.rows[0].payload_hash === 'pending') {
        console.error(\`[execution-layer] hash verify failed for \${logId}\`);
      }

      return logId;
    } catch (e) {
      console.error(\`[execution-layer] event_log error: \${e.message}\`);
      return null;
    }
  }`;

    const newMethod = `async writeEventLog(eventType, agentId, customerId, payload, policyVersionId) {
    try {
      // Step 1: compute hash BEFORE insert using stringified payload
      const payloadStr = JSON.stringify(payload);
      const hash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');

      // Step 2: INSERT with hash in one shot — no race condition possible
      const insertResult = await pool.query(
        \`INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash, policy_version_id, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,NOW()) RETURNING id\`,
        [eventType, agentId, customerId, payloadStr, hash, policyVersionId]
      );
      const logId = insertResult.rows[0].id;

      // Step 3: read back DB-ordered text and re-hash to ensure consistency
      const sel = await pool.query('SELECT payload::text as raw_text FROM event_log WHERE id=$1', [logId]);
      const dbHash = crypto.createHash('sha256').update(sel.rows[0].raw_text, 'utf8').digest('hex');

      // Step 4: if DB reordered jsonb, update to match
      if (dbHash !== hash) {
        await pool.query('UPDATE event_log SET payload_hash=$1 WHERE id=$2', [dbHash, logId]);
      }

      // Step 5: final verify
      const verify = await pool.query('SELECT payload_hash FROM event_log WHERE id=$1', [logId]);
      const finalHash = verify.rows[0].payload_hash;
      if (finalHash === 'computing' || finalHash === 'pending' || finalHash === 'pending...') {
        console.error(\`[execution-layer] HASH BUG for \${logId}: still \${finalHash}\`);
      }

      return logId;
    } catch (e) {
      console.error(\`[execution-layer] event_log error: \${e.message}\`);
      return null;
    }
  }`;

    if (el.includes('computing',$5,NOW())) {
      el = el.replace(oldMethod, newMethod);
      fs.writeFileSync(elPath, el, 'utf8');
      console.log('  ✅ writeEventLog rewritten — single INSERT with pre-computed hash');
    } else {
      console.log('  ⚠️ method signature changed, skipping replace');
    }

    // ============================================
    // PHASE 3: Re-test with fresh module import
    // ============================================
    console.log('\n🧪 PHASE 3: Re-testing...');

    // Clear test data
    await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'fix2-%'").catch(()=>{});
    await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'fix2-%'").catch(()=>{});

    // Dynamic reimport
    const { executionLayer } = await import('./agents/governance/execution-layer.js?t=' + Date.now());

    // Test A: valid execution
    console.log('\n--- Test A: valid contract + execution ---');
    const nA = 'fix2-' + crypto.randomUUID();
    const sA = crypto.createHash('sha256').update(nA).digest('hex').substring(0, 32);
    const cA = await pool.query(
      `INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at)
       VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id`,
      [nA, 'ha', sA]
    );
    const rA = await executionLayer.execute({
      id: cA.rows[0].id, nonce: nA, signature: sA,
      task_type: 'general_query', intent: 'اختبار بعد الإصلاح', agent_id: 'fix_test'
    }, { question: 'ما هو 2+2؟ أجب بـJSON فقط' });
    console.log(`  success: ${rA.success}`);
    if (rA.success) {
      console.log(`  confidence: ${rA.metadata.confidence} | latency: ${rA.metadata.latency_ms}ms`);
    } else {
      console.log(`  error: ${rA.error}`);
    }

    // Test B: replay rejection
    console.log('\n--- Test B: replay rejection ---');
    const rB = await executionLayer.execute({
      id: cA.rows[0].id, nonce: nA, signature: sA,
      task_type: 'general_query', intent: 'إعادة', agent_id: 'fix_test'
    }, { question: 'محاولة ثانية' });
    console.log(`  success: ${rB.success} | error: ${rB.error}`);

    // Test C: expired contract
    console.log('\n--- Test C: expired contract ---');
    const nC = 'fix2-' + crypto.randomUUID();
    const sC = crypto.createHash('sha256').update(nC).digest('hex').substring(0, 32);
    const cC = await pool.query(
      `INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at)
       VALUES ($1,$2,$3,NOW()-INTERVAL '1 hour',false,NOW()) RETURNING id`,
      [nC, 'hc', sC]
    );
    const rC = await executionLayer.execute({
      id: cC.rows[0].id, nonce: nC, signature: sC
    }, { q: 'test' });
    console.log(`  success: ${rC.success} | error: ${rC.error}`);

    // ============================================
    // PHASE 4: Final verification
    // ============================================
    console.log('\n✅ PHASE 4: DB verification');

    const badFinal = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
    console.log(`  bad hashes remaining: ${badFinal.rows[0].c}`);

    const lastEv = await pool.query("SELECT event_type, substring(payload_hash,1,24) as h FROM event_log ORDER BY created_at DESC LIMIT 5");
    console.log('\n  last 5 event_log:');
    lastEv.rows.forEach(r => console.log(`    ${r.event_type} | ${r.h}...`));

    const lastRd = await pool.query("SELECT task_type, model_selected, confidence, outcome FROM routing_decisions ORDER BY created_at DESC LIMIT 3");
    console.log('\n  last 3 routing_decisions:');
    lastRd.rows.forEach(r => console.log(`    ${r.task_type} | ${r.model_selected} | conf:${r.confidence} | ${r.outcome}`));

    console.log('\n🏁 اكتمل');

  } catch(e) { console.error('FATAL:', e.message, e.stack); }
  await pool.end();
}
fix();
