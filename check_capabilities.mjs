
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = msg => console.log('['+new Date().toISOString()+'] '+msg);

// فحص بنية model_capabilities أولاً
const cols = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_capabilities' ORDER BY ordinal_position");
log('=== model_capabilities columns ===');
cols.rows.forEach(x=>log('  '+x.column_name+' | '+x.data_type+' | '+x.is_nullable));

const cnt = await pool.query('SELECT COUNT(*) FROM model_capabilities');
log('current count: '+cnt.rows[0].count);

const cons = await pool.query("SELECT pg_get_constraintdef(oid) as def, contype FROM pg_constraint WHERE conrelid='model_capabilities'::regclass");
log('constraints:');
cons.rows.forEach(x=>log('  '+x.contype+': '+x.def));
await pool.end();
