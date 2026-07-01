import pg from 'pg'; import dotenv from 'dotenv'; dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL_INTELLIGENCE,ssl:{rejectUnauthorized: true}});
class DQAgent{
  async audit(){
    console.log('=== DATA QUALITY ===');
    const tables=[
      {t:'models',c:['slug','name','vendor_id']},
      {t:'vendors',c:['name']},
      {t:'model_pricing_tiers',c:['price','model_id']},
      {t:'model_benchmarks',c:['score','model_id','benchmark_definition_id']}
    ];
    let tv=0,tiv=0;
    for(const t of tables){
      try{
        const c=await pool.query('SELECT COUNT(*) as c FROM '+t.t);tv+=parseInt(c.rows[0].c);
        for(const col of t.c){
          const n=await pool.query('SELECT COUNT(*) as c FROM '+t.t+' WHERE '+col+' IS NULL');tiv+=parseInt(n.rows[0].c);
        }
        console.log(t.t.padEnd(25),tv.toString().padStart(5),'rows |',tiv,'NULLs');
      }catch(e){console.error(t.t,':',e.message.split(String.fromCharCode(10))[0]);}
    }
    console.log('\nQuality:',Math.round(((tv-tiv)/tv)*100)+'%');
    
    // Enrich - FIXED: check lc as NUMBER not boolean
    const ml=(await pool.query("SELECT id,slug,name,is_open_source,context_window,cardinality(supported_languages) as lc,(SELECT COUNT(*) FROM model_benchmarks mb WHERE mb.model_id=m.id) as bc,(SELECT COUNT(*) FROM model_capabilities mc WHERE mc.model_id=m.id) as cc FROM models m WHERE status='active'")).rows;
    console.log('Enriching',ml.length,'models...');
    let en=0;let totalComp=0;
    for(const m of ml){
      let comp=0;if(m.name&&m.name!=='{}')comp+=20;
      if(m.context_window&&typeof m.context_window==='number'&&m.context_window>0)comp+=15;
      // FIX: check lc as number, not boolean
      const langCount=typeof m.lc==='number'?m.lc:(m.supported_languages?m.supported_languages.length:0);
      if(langCount>=5)comp+=20;if(langCount>=10)comp+=10;
      if(m.bc>=3)comp+=15;if(m.cc>=5)comp+=15;
      if(m.is_open_source===true)comp+=10;
      
      // Only enrich if comp > 30 (meaningful data exists)
      if(comp>=30){
        try{
          await pool.query(
            "UPDATE models SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{compl}',$1::jsonb) WHERE id=$2",
            [JSON.stringify(comp), m.id]
          );
          en++;
        }catch(e){
          console.error('  enrich error for', m.id, e.message);
        }
        if(en%5===0)console.log('  enriched:',en,'/',ml.length);
      }
    }
    console.log('\nEnriched:',en,'/',ml.length,'| Total comp:',totalComp/ml.length);
    console.log('\n📊 DATA QUALITY OPERATIONAL!');
    process.exit(0);
  }
}
const dq=new DQAgent();dq.audit();
export default dq;
