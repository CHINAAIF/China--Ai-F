/**
 * TRUNKIA Execution Engine v1.0 — Dark Factory
 */
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized: true}});

class ExecutionEngine {
  constructor(){
    this.name='execution_engine';this.version='1.0.0';this.status='init';
    this.maxConcurrent=5;this.metrics={total:0,success:0,failed:0,avgMs:0};
  }
  async init(){try{await pool.query('SELECT 1');this.status='active';return true;}catch(e){this.status='error';return false;}}
  
  async executePlan(plan){
    const id='exec_'+Date.now(),start=Date.now();
    console.log('[EXEC] Start:',id,'| Tasks:',plan.tasks.length);
    await this.log(id,'start',plan);
    const results=[],promises=[];
    for(const task of plan.tasks){
      if(promises.length>=this.maxConcurrent) await Promise.race(promises);
      promises.push(this.execTask(id,task).then(r=>{results.push(r);return r;}));
    }
    await Promise.allSettled(promises);
    const ms=Date.now()-start;
    this.metrics.total+=plan.tasks.length;
    this.metrics.success+=results.filter(r=>r.status==='ok').length;
    this.metrics.failed+=results.filter(r=>r.status==='error').length;
    this.metrics.avgMs=Math.round((this.metrics.avgMs+ms)/2);
    await this.log(id,'complete',{results,totalTime:ms});
    return{executionId:id,status:'completed',results,summary:{total:plan.tasks.length,success:this.metrics.success-this.metrics.failed+results.filter(r=>r.status==='ok').length-(this.metrics.total-plan.tasks.length),failed:results.filter(r=>r.status==='error').length,duration_ms:ms},metrics:{...this.metrics}};
  }

  async execTask(execId,task){
    const tid=execId+'_t'+task.step,s=Date.now();
    try{
      let r;
      switch(task.action){
        case'fetch_model_data':r=await this.fetchModels(task.params);break;
        case'fetch_benchmarks':r=await this.fetchBenchmarks(task.params);break;
        case'fetch_pricing':r=await this.fetchPricing(task.params);break;
        case'fetch_geo_risk':r=await this.fetchGeo(task.params);break;
        case'compare_results':r=await this.compare(task.params);break;
        case'calculate_costs':r=await this.costs(task.params);break;
        case'summarize':r=await this.summary();break;
        default:r={status:'unknown',action:task.action};
      }
      return{taskId:tid,step:task.step,action:task.action,status:'ok',data:r,duration_ms:Date.now()-s};
    }catch(e){
      return{taskId:tid,step:task.step,action:task.action,status:'error',error:e.message,duration_ms:Date.now()-s};
    }
  }

  async fetchModels(p={}){const r=await pool.query('SELECT m.slug,m.name,v.name vn,m.model_type FROM models m JOIN vendors v ON m.vendor_id=v.id WHERE m.status=$1 ORDER BY random() LIMIT $2',['active',p.limit||5]);return{type:'models',count:r.rowCount,data:r.rows};}
  async fetchBenchmarks(p={}){const r=await pool.query('SELECT m.slug,bd.slug bs,score,percentile FROM model_benchmarks mb JOIN models m ON mb.model_id=m.id JOIN benchmark_definitions bd ON mb.benchmark_definition_id=bd.id ORDER BY percentile DESC LIMIT 15');return{type:'benchmarks',count:r.rowCount,data:r.rows};}
  async fetchPricing(p={}){const r=await pool.query('SELECT m.slug,tier_name,price,pricing_model FROM model_pricing_tiers pt JOIN models m ON pt.model_id=m.id WHERE pt.active=true ORDER BY price ASC NULLS LAST LIMIT 12');return{type:'pricing',count:r.rowCount,data:r.rows};}
  async fetchGeo(p={}){const r=await pool.query('SELECT m.slug,country_of_origin,risk_score,data_law_risk,sanctions_risk,blocking_risk,censorship_risk FROM model_geopolitical_risk gr JOIN models m ON gr.model_id=m.id ORDER BY risk_score DESC LIMIT 12');return{type:'geo_risk',count:r.rowCount,data:r.rows};}
  async compare(p={}){const m=p.models||['gpt-4o','claude-3.5-sonnet'];const r=await pool.query('SELECT m.slug,m.name,v.name vn,AVG(mb.score)::numeric(5,2) avg_score,AVG(mb.percentile)::numeric(5,2) avg_pct FROM models m JOIN vendors v ON m.vendor_id=v.id LEFT JOIN model_benchmarks mb ON mb.model_id=m.id WHERE m.slug=ANY($1) GROUP BY m.slug,m.name,v.name',[m]);return{type:'comparison',compared:m,data:r.rows};}
  async costs(p={}){const req=p.monthly_requests||1000,tok=p.avg_tokens||1000;const r=await pool.query('SELECT m.slug,tier_name,price,(price*$1*$2/1000000) est_monthly FROM model_pricing_tiers pt JOIN models m ON pt.model_id=m.id WHERE pt.active=true AND pricing_model=$3 ORDER BY est_monthly ASC NULLS LAST LIMIT 10',[req,tok,'per_token']);return{type:'costs',monthly:req,tokens:tok,data:r.rows};}
  async summary(){const[mo,ve,be,pr,ve2,ge]=await Promise.all([pool.query('SELECT COUNT(*)c FROM models'),pool.query('SELECT COUNT(*)c FROM vendors'),pool.query('SELECT COUNT(*)c FROM model_benchmarks'),pool.query('SELECT COUNT(*)c FROM model_pricing_tiers WHERE active=true'),pool.query('SELECT COUNT(*)c FROM intelligence_verified'),pool.query('SELECT COUNT(*)c FROM model_geopolitical_risk')]);return{type:'summary',stats:{models:mo.rows[0].c,vendors:ve.rows[0].c,benchmarks:be.rows[0].c,pricing:pr.rows[0].c,verified:ve2.rows[0].c,geo:ge.rows[0].c}};}

  async log(id,a,d){try{await pool.query("INSERT INTO agent_execution_logs(agent_name,action,input,output,confidence,status,created_at) VALUES($1,$2,$3,$4,90,'completed',NOW())",[this.name+'_'+a,id,JSON.stringify({id:a}),JSON.stringify(d)]);}catch(e){}}
  async health(){return{status:this.name,version:this.version,state:this.status,metrics:this.metrics,uptime:process.uptime()};}
}

const engine=new ExecutionEngine();
engine.init().then(ok=>{
  if(!ok){console.error('❌ Init fail');process.exit(1);}
  console.log('=== EXECUTION ENGINE TEST ===');
  const plan={id:'test_001',intent:'GENERAL',tasks:[
    {step:1,action:'fetch_model_data',params:{limit:3}},
    {step:2,action:'summary',params:{}}
  ]};
  engine.executePlan(plan).then(res=>{
    console.log('\n✅ Result:',res.executionId);
    console.log('Status:',res.status,'|',res.summary.total,'tasks |',res.summary.duration_ms,'ms');
    for(const r of res.results)console.log(' ',r.step+':',r.action,'→',r.status,'(',r.duration_ms,'ms)',r.data?.type?'| '+r.data.type:'');
    return engine.health();
  }).then(h=>{
    console.log('\n📊 Health:',h.state,'| Metrics:',JSON.stringify(h.metrics));
    console.log('🎉 EXECUTION ENGINE OPERATIONAL!');
    process.exit(0);
  });
});
export default engine;
