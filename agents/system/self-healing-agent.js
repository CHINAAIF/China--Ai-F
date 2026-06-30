import pg from 'pg'; import dotenv from 'dotenv'; dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized: true}});
class SHAgent{
  async heal(){
    console.log('=== SELF-HEALING ===');
    let fixes=0;
    // Fix orphans
    const ov=await pool.query("SELECT id,slug FROM models WHERE vendor_id NOT IN (SELECT id FROM vendors)");
    const fv=(await pool.query("SELECT id FROM vendors LIMIT 1")).rows[0];
    for(const o of ov.rows){await pool.query("UPDATE models SET vendor_id=$1 WHERE id=$2",[fv.id,o.id]);fixes++;}
    if(fixes>0)console.log('✅ Orphans fixed:',fixes);
    // Fix NULL names
    const nn=await pool.query("SELECT id,slug FROM models WHERE name IS NULL OR name='{}'");
    for(const n of nn.rows){await pool.query("UPDATE models SET name=$1::jsonb WHERE id=$2",[JSON.stringify({en:n.slug}),n.id]);fixes++;}
    if(nn.rowCount>0)console.log('✅ Names fixed:',nn.rowCount);
    // Fix stale - without rejected_reason column
    const st=await pool.query("UPDATE intelligence_raw SET filter_status='rejected' WHERE filter_status='pending' AND collected_at < NOW()-INTERVAL '7 days'");
    fixes+=parseInt(st.rowCount);
    if(parseInt(st.rowCount)>0)console.log('✅ Stale rejected:',st.rowCount);
    console.log('Total fixes:',fixes);
    console.log('🔄 SELF-HEALING OPERATIONAL!');
    process.exit(0);
  }
}
const sh=new SHAgent();sh.heal();
export default sh;
