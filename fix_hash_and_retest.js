import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });

async function fix() {
  try {
    // 1. Clean duplicate test nonces
    await pool.query("DELETE FROM governance_contracts WHERE nonce LIKE 'test-%'").catch(()=>{});
    await pool.query("DELETE FROM nonce_registry WHERE nonce LIKE 'test-%'").catch(()=>{});
    console.log('✅ cleaned test data');

    // 2. Fix ALL pending/computing hashes in event_log
    const bad = await pool.query("SELECT id FROM event_log WHERE payload_hash IN ('pending','pending...','computing') ORDER BY created_at");
    console.log(`\n🔧 fixing ${bad.rows.length} bad hashes...`);
    let fixed = 0, failed = 0;
    for (const row of bad.rows) {
      try {
        const sel = await pool.query('SELECT payload::text as raw_text FROM event_log WHERE id=$1', [row.id]);
        if (sel.rows.length === 0) { failed++; continue; }
        const hash = crypto.createHash('sha256').update(sel.rows[0].raw_text, 'utf8').digest('hex');
        await pool.query('UPDATE event_log SET payload_hash=$1 WHERE id=$2', [hash, row.id]);
        const v = await pool.query('SELECT payload_hash FROM event_log WHERE id=$1', [row.id]);
        if (v.rows[0].payload_hash !== 'pending' && v.rows[0].payload_hash !== 'computing') {
          fixed++;
        } else { failed++; }
      } catch(e) { failed++; }
    }
    console.log(`  fixed: ${fixed} | failed: ${failed}`);

    // 3. Verify no more bad hashes
    const remaining = await pool.query("SELECT count(*) as c FROM event_log WHERE payload_hash IN ('pending','pending...','computing')");
    console.log(`\n✅ remaining bad hashes: ${remaining.rows[0].c}`);

    // 4. Show last 5 event_log hashes as proof
    const last5 = await pool.query("SELECT event_type, substring(payload_hash,1,20) as h FROM event_log ORDER BY created_at DESC LIMIT 5");
    console.log('\n📋 last 5 event_log hashes:');
    last5.rows.forEach(r => console.log(`  ${r.event_type} | ${r.h}...`));

    // 5. Now run the actual execution tests with unique nonces
    console.log('\n--- اختبار 1: عقد غير موجود ---');
    const { executionLayer } = await import('./agents/governance/execution-layer.js');
    const r1 = await executionLayer.execute({ id: '00000000-0000-0000-0000-000000000000' }, { q: 'test' });
    console.log(`success: ${r1.success} | error: ${r1.error}`);

    console.log('\n--- اختبار 2: عقد منتهي الصلاحية ---');
    const n2 = crypto.randomUUID();
    const s2 = crypto.createHash('sha256').update(n2).digest('hex').substring(0, 32);
    const c2 = await pool.query(
      `INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at)
       VALUES ($1,$2,$3,NOW()-INTERVAL '1 hour',false,NOW()) RETURNING id`,
      [n2, 'h2', s2]
    );
    const r2 = await executionLayer.execute({ id: c2.rows[0].id, nonce: n2, signature: s2 }, { q: 'test' });
    console.log(`success: ${r2.success} | error: ${r2.error}`);

    console.log('\n--- اختبار 3: عقد صالح + تنفيذ فعلي ---');
    const n3 = crypto.randomUUID();
    const s3 = crypto.createHash('sha256').update(n3).digest('hex').substring(0, 32);
    const c3 = await pool.query(
      `INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at)
       VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id`,
      [n3, 'h3', s3]
    );
    const r3 = await executionLayer.execute({
      id: c3.rows[0].id, nonce: n3, signature: s3,
      task_type: 'general_query', intent: 'ما هو TRUNKIA', agent_id: 'test_agent'
    }, { question: 'ما هو TRUNKIA باختصار؟' });
    console.log(`success: ${r3.success}`);
    if (r3.success) {
      console.log(`confidence: ${r3.metadata.confidence} | latency: ${r3.metadata.latency_ms}ms`);
      console.log(`tokens: ${r3.metadata.tokens_in}/${r3.metadata.tokens_out} | cost: $${r3.metadata.cost_usd}`);
      console.log(`pii_masked: ${r3.metadata.pii_masked} | byok: ${r3.metadata.byok_used}`);
    } else { console.log(`error: ${r3.error}`); }

    console.log('\n--- اختبار 4: رفض إعادة التشغيل ---');
    const r4 = await executionLayer.execute({
      id: c3.rows[0].id, nonce: n3, signature: s3,
      task_type: 'general_query', intent: 'محاولة إعادة', agent_id: 'test_agent'
    }, { question: 'محاولة ثانية' });
    console.log(`success: ${r4.success} | error: ${r4.error}`);

    console.log('\n--- اختبار 5: حجب PII ---');
    const n5 = crypto.randomUUID();
    const s5 = crypto.createHash('sha256').update(n5).digest('hex').substring(0, 32);
    const c5 = await pool.query(
      `INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used, created_at)
       VALUES ($1,$2,$3,NOW()+INTERVAL '30 seconds',false,NOW()) RETURNING id`,
      [n5, 'h5', s5]
    );
    const r5 = await executionLayer.execute({
      id: c5.rows[0].id, nonce: n5, signature: s5,
      task_type: 'general_query', intent: 'تحليل بيانات', agent_id: 'test_agent'
    }, { question: 'بريدي user@company.com وهاتفي 0512345678', email: 'admin@secret.com', ip: '192.168.1.100' });
    console.log(`success: ${r5.success}`);

    // Verify DB
    console.log('\n✅ آخر 3 routing_decisions:');
    const rd = await pool.query('SELECT task_type, model_selected, confidence, outcome, latency_ms FROM routing_decisions ORDER BY created_at DESC LIMIT 3');
    rd.rows.forEach(r => console.log(`  ${r.task_type} | ${r.model_selected} | conf:${r.confidence} | ${r.outcome} | ${r.latency_ms}ms`));

    console.log('\n✅ آخر 5 event_log hashes:');
    const ev = await pool.query("SELECT event_type, substring(payload_hash,1,20) as h FROM event_log ORDER BY created_at DESC LIMIT 5");
    ev.rows.forEach(r => console.log(`  ${r.event_type} | ${r.h}...`));

    console.log('\n🏁 اكتمل');
  } catch(e) { console.error('FATAL:', e.message); }
  await pool.end();
}
fix();
