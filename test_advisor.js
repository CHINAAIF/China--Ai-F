import dotenv from 'dotenv'; dotenv.config();
import { advisorLayer } from './agents/governance/advisor-layer.js';

console.log('🔍 تهيئة advisor-layer...');
const init = await advisorLayer.initialize();
console.log('initialize:', init, '| status:', advisorLayer.status);

if (!init) {
  console.error('❌ فشل التهيئة — توقف');
  process.exit(1);
}

// اختبار 1: طلب عادي
console.log('\n--- اختبار 1: طلب intelligence عادي ---');
const r1 = await advisorLayer.advise({ action: 'compare_models', query: 'GPT-4 vs Claude' }, null);
console.log('success:', r1.success);
console.log('intent:', r1.decision?.intent);
console.log('confidence:', r1.decision?.confidence);
console.log('contract_id:', r1.contract?.contract_id);
console.log('latency_ms:', r1.latency_ms);

// اختبار 2: طلب مالي — escalation_tier 4
console.log('\n--- اختبار 2: طلب financial ---');
const r2 = await advisorLayer.advise({ action: 'billing', query: 'invoice payment cost' }, null);
console.log('success:', r2.success);
console.log('intent:', r2.decision?.intent);
console.log('escalation_tier:', r2.contract?.escalation_tier);

// اختبار 3: تهديد — يجب أن يُحجب
console.log('\n--- اختبار 3: محاولة SQL injection ---');
const r3 = await advisorLayer.advise({ query: 'DROP TABLE users; SELECT * FROM byok_keys' }, null);
console.log('blocked:', r3.blocked);
console.log('success:', r3.success);

// اختبار 4: diagnostic
console.log('\n--- اختبار 4: diagnostic ---');
const r4 = await advisorLayer.runDiagnostic();
console.log('diagnostic status:', r4.status);

// تحقق فعلي من DB — القاعدة 5
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const verify = await pool.query(
  `SELECT id, nonce, used, content_hash, signature, valid_until 
   FROM governance_contracts 
   ORDER BY created_at DESC LIMIT 3`
);
console.log('\n✅ تحقق DB — آخر 3 عقود:');
verify.rows.forEach(r => {
  console.log(`  id:${r.id} | used:${r.used} | hash:${r.content_hash?.substring(0,16)}... | valid_until:${r.valid_until}`);
});

const evLogs = await pool.query(
  `SELECT id, event_type, agent_id, payload_hash 
   FROM event_log 
   WHERE agent_id='advisor_layer' 
   ORDER BY created_at DESC LIMIT 3`
);
console.log('\n✅ تحقق DB — آخر 3 event_log:');
evLogs.rows.forEach(r => {
  console.log(`  type:${r.event_type} | hash:${r.payload_hash?.substring(0,16)}...`);
});

await pool.end();
console.log('\n🏁 الاختبار اكتمل');
