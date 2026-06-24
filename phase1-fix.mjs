
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

console.log('TRUNKIA Phase 1 Fix...');

// STEP 1: Intelligence Pipeline
const toProcess = await pool.query(`
  SELECT ir.* FROM intelligence_raw ir
  LEFT JOIN intelligence_verified iv ON iv.raw_id = ir.id
  WHERE ir.filter_status = 'passed' AND iv.id IS NULL
`);
console.log('Processing', toProcess.rowCount, 'records...');

let p=0,s=0,e=0;
for (const r of toProcess.rows) {
  try {
    if (!r.raw_content || r.raw_content.length < 20) {s++;continue;}
    let obj;
    try {obj = JSON.parse(r.raw_content);} catch(e) {obj={raw:r.raw_content};}
    let imp='low'; if(r.confidence>=80)imp='medium';if(r.confidence>=90)imp='high';
    await pool.query(`
      INSERT INTO intelligence_verified (raw_id,verified_content,verification_count,sources_confirmed,impact_level,published,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
    `,[r.id,JSON.stringify(obj),1,[r.agent_name||'pipeline'],imp,false]);
    p++;
  } catch(err) {e++;if(e<=2) console.error('ERR:',err.message.slice(0,60));}
}
console.log('Done:',p,'processed,',s,'skipped,',e,'errors');

// STEP 2: Geopolitical Risk
const miss = await pool.query(`
  SELECT m.id,m.slug,m.name,v.name vn FROM models m
  JOIN vendors v ON m.vendor_id=v.id
  LEFT JOIN model_geopolitical_risk g ON g.model_id=m.id WHERE g.id IS NULL
`);
console.log('Adding geo risk for',miss.rowCount,'models...');
let a=0;
for (const m of miss.rows) {
  try {
    let c='Unknown',rs=5,dlr=5,sr=0,br=2,cr=3;
    const vn=(m.vn?.en||m.vn||'').toLowerCase(),sl=m.slug.toLowerCase();
    if(/deepseek|alibaba|baidu|huawei|qwen/.test(sl)){c='China';rs=7;dlr=9;sr=6;br=8;cr=9;}
    else if(/openai|anthropic|google|meta|microsoft|nvidia|amazon|xai|cohere/.test(sl)){c='US';rs=3;dlr=2;sr=1;br=1;cr=1;}
    else if(/mistral/.test(sl)){c='EU';rs=2;dlr=1;sr=0;br=0;cr=0;}
    await pool.query(`
      INSERT INTO model_geopolitical_risk (model_id,country_of_origin,risk_score,data_law_risk,sanctions_risk,blocking_risk,censorship_risk,notes,assessed_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    `,[m.id,c,rs,dlr,sr,br,cr,'Auto:'+m.slug]);
    a++;
  } catch(err){if(a<2) console.error('GEO ERR:',m.slug,err.message.slice(0,40));}
}
console.log('Added:',a);

// STEP 3: Subscription Plans
const ex = await pool.query('SELECT COUNT(*) c FROM subscription_plans');
if(parseInt(ex.rows[0].c)===0){
  const bi = (await pool.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON enumtypid=oid WHERE typname='billing_interval' LIMIT 1")).rows[0]?.enumlabel||'monthly';
  const plans=[
    {slug:'free',name:'{"en":"Free","ar":"مجاني"}',desc:'Limited comparisons',price:0,fs:'{"limited":true,"delay":24}'},
    {slug:'pro',name:'{"en":"Pro","ar":"احترافي"}',desc:'Full access real-time',price:19.99,fs:'{"unlimited":true,"api":true,"alerts":true}'},
    {slug:'enterprise',name:'{"en":"Enterprise","ar":"مؤسسي"}',desc:'Custom benchmarks SLA',price:199.99,fs:'{"custom":true,"sla":"99.9%","support":"dedicated"}'}
  ];
  for(const pl of plans){
    await pool.query("INSERT INTO subscription_plans(name,slug,description,currency,price,billing_interval,active,feature_set,created_at,updated_at) VALUES($1,$2,$3,'USD',$4,$5,true,$6,NOW(),NOW())",[pl.name,pl.slug,pl.desc,pl.price,bi,pl.fs]);
    console.log('  Plan:',pl.slug,'$'+pl.price);
  }
}

// SUMMARY
const v=(await pool.query('SELECT COUNT(*)c FROM intelligence_verified')).rows[0].c;
const g=(await query('SELECT COUNT(*)c FROM model_geopolitical_risk')).rows[0].c;
const pl=(await query('SELECT COUNT(*)c FROM subscription_plans')).rows[0].c;
const m=(await query('SELECT COUNT(*)c FROM models')).rows[0].c;
console.log('\n=== SUMMARY ===');
console.log('Verified:',v,'| Geo:',g+'/'+m,'| Plans:',pl);
console.log('PHASE 1 COMPLETE!');
await pool.end();
