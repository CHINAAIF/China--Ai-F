import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-32-chars-minimum!!';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

// إصلاح المشكلة 1 — payload_hash بقي pending
console.log('=== إصلاح payload_hash المعلق ===');
const pending = await pool.query(
  `SELECT id, payload::text AS raw FROM event_log WHERE payload_hash='pending' LIMIT 50`
);
console.log('pending rows:', pending.rows.length);

for (const row of pending.rows) {
  try {
    const hash = crypto.createHash('sha256').update(row.raw).digest('hex');
    const sig = crypto.createHmac('sha256', ENCRYPTION_KEY).update(hash).digest('hex');
    await pool.query(
      'UPDATE event_log SET payload_hash=$1, signature=$2 WHERE id=$3',
      [hash, sig, row.id]
    );
    // تحقق فعلي
    const verify = await pool.query('SELECT payload_hash FROM event_log WHERE id=$1', [row.id]);
    console.log(`✅ id:${row.id} | hash:${verify.rows[0].payload_hash.substring(0,16)}...`);
  } catch(e) {
    console.error(`❌ id:${row.id} | error:${e.message}`);
  }
}

await pool.end();
console.log('✅ إصلاح payload_hash اكتمل');
