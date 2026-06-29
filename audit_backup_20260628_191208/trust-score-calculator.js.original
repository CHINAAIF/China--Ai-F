import pg from 'pg'; import dotenv from 'dotenv'; dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
class TrustScore {
  constructor(){this.w={a:0.30,r:0.20,s:0.30,st:0.20};}
  async calc(slug){
    const s=Date.now();let acc=50,rep=75,saf=50,stb=80;
    try{const b=await pool.query("SELECT AVG(percentile)::numeric(5,2) as a FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id WHERE m.slug=$1",[slug]);if(b.rows[0]?.a)acc=Math.min(100,Math.round(b.rows[0].a*1.2));}catch(e){}
    try{const v=await pool.query("SELECT s.reputation_score FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN vendors v ON m.vendor_id=v.id LEFT JOIN sources s ON s.name::text ILIKE '%'||v.name::text||'%' WHERE m.slug=$1 LIMIT 1",[slug]);if(v.rows[0]?.reputation_score)rep=v.rows[0].reputation_score;}catch(e){}
    try{const g=await pool.query("SELECT risk_score,data_law_risk,blocking_risk,censorship_risk FROM model_geopolitical_risk gr JOIN models m ON gr.model_id=m.id WHERE m.slug=$1",[slug]);if(g.rows[0]){const rc=(g.rows[0].risk_score*0.4)+(g.rows[0].data_law_risk*0.25)+(g.rows[0].blocking_risk*0.20)+(g.rows[0].censorship_risk*0.15);saf=Math.max(0,100-Math.round(rc*10));}}catch(e){}
    try{const pc=await pool.query("SELECT COUNT(*)::int as c FROM pricing_history WHERE model_id=(SELECT id FROM models WHERE slug=$1) AND created_at > NOW()-INTERVAL '30 days'",[slug]);const ch=parseInt(pc.rows[0]?.c||0);stb=Math.max(0,100-ch*5);}catch(e){}
    const t=Math.round((acc*this.w.a)+(rep*this.w.r)+(saf*this.w.s)+(stb*this.w.st));
    let lv='MODERATE',cl='yellow';if(t>=80){lv='HIGH';cl='green';}else if(t>=60){lv='GOOD';cl='lime';}else if(t>=40){lv='MODERATE';cl='yellow';}else if(t>=20){lv='LOW';cl='orange';}else{lv='RISKY';cl='red';}
    return{model:slug,trust:t,max:100,level:lv,color:cl,factors:{acc,rep,saf,stb},rec:t>=60?'RECOMMENDED':'CAUTION',ms:Date.now()-s};
  }
  async batch(n=10){
    const ml=(await pool.query("SELECT slug FROM models WHERE status='active' ORDER BY random() LIMIT $1",[n])).rows;
    const r=[];for(const m of ml){r.push(await this.calc(m.slug));}
    r.sort((a,b)=>b.trust-a.trust);return r;
  }
}
const ts=new TrustScore();
ts.batch(8).then(r=>{console.log('=== TRUST SCORE ===');for(const x of r){console.log(x.trust.toString().padStart(3),x.level.padEnd(12),'|',x.model.padEnd(28),'|',x.color);console.log('  acc:',x.factors.acc,'| rep:',x.factors.rep,'| saf:',x.factors.saf,'| stb:',x.factors.stb);}console.log('\n🎯 TRUST SCORE OPERATIONAL!');process.exit(0);});
export default ts;
