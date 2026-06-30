
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: true}});

async function fixAvailabilityEnum() {
  try {
    // ابحث عن كل enum types تحتوي availability
    const types = await pool.query(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as vals
      FROM pg_enum e 
      JOIN pg_type t ON e.enumtypid = t.oid 
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public' AND t.typname LIKE '%avail%'
      GROUP BY t.typname
    `);
    console.log('Enum types matching availability:', JSON.stringify(types.rows));
    
    // ابحث عن أي عمود يستخدم هذا الـenum
    if (types.rows.length > 0) {
      for (const t of types.rows) {
        const cols = await pool.query(`
          SELECT table_name, column_name FROM information_schema.columns 
          WHERE udt_name = $1 AND table_schema = 'public'
        `, [t.typname]);
        console.log('Columns using ' + t.typname + ':', JSON.stringify(cols.rows));
        console.log('Values:', t.vals);
        console.log('Unique values:', [...new Set(t.vals)]);
      }
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
  await pool.end();
}
fixAvailabilityEnum();
