import dotenv from 'dotenv'; import pg from 'pg'; dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
class CostCalcAgent {
  constructor(){this.name='cost_calculator';this.version='1.0.0';}
  async calculate(params){
    const mr=params.monthly_requests||1000, at=params.avg_tokens||1000;
    const r=await pool.query(`
      SELECT m.slug,m.name,v.name vn,t.tier_name,t.price,t.pricing_model,
             CAST(t.price * CAST($1 AS numeric) * CAST($2 AS numeric) / 1000000 AS numeric(10,2)) as est_monthly
      FROM model_pricing_tiers t JOIN models m ON t.model_id=m.id
      JOIN vendors v ON m.vendor_id=v.id
      WHERE t.active=true AND t.pricing_model='per_token'
      ORDER BY est_monthly ASC NULLS LAST LIMIT 15
    `,[mr,at]);
    return{type:'cost_calc',params:{monthly_requests:mr,avg_tokens:at},results:r.rowCount,models:r.rows,duration_ms:Date.now()-Date.now()};
  }
}
const agent=new CostCalcAgent();
agent.calculate({use:'chatbot',monthly_requests:50000,avg_tokens:500}).then(r=>{
  console.log('=== COST CALCULATOR ===');
  console.log('Use:',r.params.use_case,'|',r.params.monthly_requests,'req/mo');
  for(const m of r.models) console.log(' ',m.slug.padEnd(28),'|$'+m.est_monthly+'/mo');
  console.log('Time:',r.duration_ms,'ms');
  process.exit(0);
});
export default agent;
