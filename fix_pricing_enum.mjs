
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: true}});

async function fixEnum() {
  console.log('════════════════════════════════════════════');
  console.log('FIX: pricing_model_type ENUM');
  console.log('════════════════════════════════════════════');
  
  try {
    const colCheck = await pool.query("SELECT udt_name FROM information_schema.columns WHERE table_name='model_pricing_tiers' AND column_name='pricing_model'");
    if (!colCheck.rows.length) {
      console.log('Column not found, checking all columns...');
      const all = await pool.query("SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='model_pricing_tiers'");
      console.log('Columns:', all.rows.map(r => r.column_name + '(' + r.udt_name + ')').join(', '));
      await pool.end();
      return;
    }
    
    const udtName = colCheck.rows[0].udt_name;
    console.log('UDT:', udtName);
    
    const current = await pool.query("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname=$1", [udtName]);
    console.log('Current values:', current.rows.length > 0 ? current.rows.map(r=>r.enumlabel).join(', ') : 'EMPTY');
    
    if (current.rows.length > 0) {
      console.log('Enum already populated');
      await pool.end();
      return;
    }
    
    const values = ['per_token','per_request','subscription','token_pack','compute_unit','hybrid','free','contact_sales'];
    for (const v of values) {
      try {
        await pool.query("ALTER TYPE " + udtName + " ADD VALUE IF NOT EXISTS '" + v + "'");
        console.log('  Added: ' + v);
      } catch(e) {
        console.log('  Error ' + v + ': ' + e.message.split('\n')[0]);
      }
    }
    
    const final = await pool.query("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname=$1", [udtName]);
    console.log('\nFinal:', final.rows.map(r=>r.enumlabel).join(', '));
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  await pool.end();
}
fixEnum();
