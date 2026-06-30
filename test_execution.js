import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { executionLayer } from './agents/governance/execution-layer.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });

async function test() {
  console.log('🔍 تهيئة execution-layer...');
  const init = await executionLayer.initialize();
  console.log(`initialize: ${init} | status: ${executionLayer.status}`);

  // Test 1: reject missing contract
  console.log('\n--- اختبار 1: عقد غير موجود ---');
  const r1 = await executionLayer.execute({ id: '00000000-0000-0000-0000-000000000000' }, { q: 'test' });
  console.log(`success: ${r1.success} | error: ${r1.error}`);

  // Test 2: reject expired contract
  console.log('\n--- اختبار 2: عقد منتهي الصلاحية ---');
  const fakeSig = crypto.createHash('sha256').update('test-expired').digest('hex').substring(0, 32);
  const expiredContract = await pool.query(
    `INSERT INTO governance_contracts (nonce, customer_id, content_hash, signature, valid_until, used, created_at)
     VALUES ($1,NULL,$2,$3,NOW() - INTERVAL '1 hour',false,NOW()) RETURNING id`,
    ['test-expired-nonce', 'hash-exp', fakeSig]
  );
  const r2 = await executionLayer.execute(
    { id: expiredContract.rows[0].id, nonce: 'test-expired-nonce', signature: fakeSig },
    { q: 'test' }
  );
  console.log(`success: ${r2.success} | error: ${r2.error}`);

  // Test 3: valid contract + actual execution
  console.log('\n--- اختبار 3: عقد صالح + تنفيذ فعلي ---');
  const nonce3 = crypto.randomUUID();
  const sig3 = crypto.createHash('sha256').update(nonce3).digest('hex').substring(0, 32);
  const validContract = await pool.query(
    `INSERT INTO governance_contracts (nonce, customer_id, content_hash, signature, valid_until, used, created_at)
     VALUES ($1,NULL,$2,$3,NOW() + INTERVAL '30 seconds',false,NOW()) RETURNING id`,
    [nonce3, 'hash-valid-3', sig3]
  );
  const r3 = await executionLayer.execute(
    {
      id: validContract.rows[0].id,
      nonce: nonce3,
      signature: sig3,
      task_type: 'general_query',
      intent: 'ما هو TRUNKIA',
      agent_id: 'test_agent'
    },
    { question: 'ما هو TRUNKIA باختصار؟' }
  );
  console.log(`success: ${r3.success}`);
  if (r3.success) {
    console.log(`confidence: ${r3.metadata.confidence}`);
    console.log(`latency_ms: ${r3.metadata.latency_ms}`);
    console.log(`tokens: ${r3.metadata.tokens_in}/${r3.metadata.tokens_out}`);
    console.log(`cost: $${r3.metadata.cost_usd}`);
    console.log(`pii_masked: ${r3.metadata.pii_masked}`);
  } else {
    console.log(`error: ${r3.error}`);
  }

  // Test 4: replay rejection (same nonce)
  console.log('\n--- اختبار 4: رفض إعادة التشغيل (نفس nonce) ---');
  const r4 = await executionLayer.execute(
    {
      id: validContract.rows[0].id,
      nonce: nonce3,
      signature: sig3,
      task_type: 'general_query',
      intent: 'محاولة إعادة',
      agent_id: 'test_agent'
    },
    { question: 'محاولة ثانية' }
  );
  console.log(`success: ${r4.success} | error: ${r4.error}`);

  // Test 5: PII masking
  console.log('\n--- اختبار 5: اختبار حجب PII ---');
  const nonce5 = crypto.randomUUID();
  const sig5 = crypto.createHash('sha256').update(nonce5).digest('hex').substring(0, 32);
  const piiContract = await pool.query(
    `INSERT INTO governance_contracts (nonce, customer_id, content_hash, signature, valid_until, used, created_at)
     VALUES ($1,NULL,$2,$3,NOW() + INTERVAL '30 seconds',false,NOW()) RETURNING id`,
    [nonce5, 'hash-pii-5', sig5]
  );
  const r5 = await executionLayer.execute(
    {
      id: piiContract.rows[0].id,
      nonce: nonce5,
      signature: sig5,
      task_type: 'general_query',
      intent: 'تحليل بيانات شخصية',
      agent_id: 'test_agent'
    },
    { question: 'بريدي user@company.com وهاتفي 0512345678', email: 'admin@secret.com', ip: '192.168.1.100' }
  );
  console.log(`success: ${r5.success}`);

  // Verify DB
  console.log('\n✅ تحقق DB — آخر 3 routing_decisions:');
  const rd = await pool.query('SELECT id, task_type, model_selected, confidence, outcome, latency_ms FROM routing_decisions ORDER BY created_at DESC LIMIT 3');
  rd.rows.forEach(r => console.log(`  ${r.task_type} | ${r.model_selected} | conf:${r.confidence} | ${r.outcome} | ${r.latency_ms}ms`));

  console.log('\n✅ تحقق DB — آخر 3 event_log (execution):');
  const ev = await pool.query("SELECT event_type, payload_hash FROM event_log WHERE event_type LIKE 'execution%' ORDER BY created_at DESC LIMIT 6");
  ev.rows.forEach(r => console.log(`  ${r.event_type} | hash:${r.payload_hash?.substring(0, 16)}...`));

  console.log('\n🏁 الاختبار اكتمل');
  await pool.end();
}
test().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
