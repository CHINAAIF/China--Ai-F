/**
 * TRUNKIA Circuit Breaker v1.0
 */
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

class CircuitBreaker {
  constructor(){
    this.name='circuit_breaker';this.version='1.0.0';
    this.FAILURE_THRESHOLD=3;
    this.RECOVERY_TIMEOUT_MS=60000;
    this.providers=new Map();this.stateLog=[];
  }

  async init(){
    try{
      const ex=await pool.query('SELECT * FROM inference_providers');
      for(const r of ex.rows){
        this.providers.set(r.id,{id:r.id,name:r.provider_name||r.id,state:'CLOSED',failures:0,lastFailure:null,lastSuccess:null,openedAt:null,totalCalls:0,totalSuccess:0,totalFailures:0});
      }
      console.log('Loaded',this.providers.size,'providers');return true;
    }catch(e){console.error('Init error:',e.message.split(String.fromCharCode(10))[0]);return false;}
  }

  async allowRequest(pid){
    const p=this.getProvider(pid);
    if(p.state==='CLOSED')return{allowed:true,reason:'normal',provider:p};
    if(p.state==='OPEN'){
      const e=Date.now()-p.openedAt;
      if(e>this.RECOVERY_TIMEOUT_MS){p.state='HALF_OPEN';await this.logState(p,'OPEN->HALF','timeout');return{allowed:true,reason:'half-test',provider:p};}
      return{allowed:false,reason:'open',provider:p};
    }
    if(p.state==='HALF_OPEN'){
      if(p.halfOpenTested)return{allowed:false,reason:'half-busy',provider:p};
      p.halfOpenTested=true;return{allowed:true,reason:'half-probe',provider:p};
    }
    return{allowed:true,reason:'default',provider:p};
  }

  async recordSuccess(pid){
    const p=this.getProvider(pid);p.totalCalls++;p.totalSuccess++;p.lastSuccess=new Date().toISOString();p.failures=0;
    if(p.state==='HALF_OPEN'){p.state='CLOSED';p.halfOpenTested=false;await this.logState(p,'HALF->CLOSED','recovered');console.log('RECOVERED:',p.name);}
    await this.syncDB(p);
  }

  async recordFailure(pid,err){
    const p=this.getProvider(pid);p.totalCalls++;p.totalFailures++;p.failures++;p.lastFailure=new Date().toISOString();
    console.warn('Fail #'+p.failures+' for',p.name);
    if(p.state==='CLOSED'&&p.failures>=this.FAILURE_THRESHOLD){p.state='OPEN';p.openedAt=Date.now();await this.logState(p,'CLOSED->OPEN','threshold');console.error('CIRCUIT OPEN:',p.name);}
    else if(p.state==='HALF_OPEN'){p.state='OPEN';p.openedAt=Date.now();p.halfOpenTested=false;await this.logState(p,'HALF->OPEN','probe-fail');console.error('Back to OPEN:',p.name);}
    await this.syncDB(p);
  }

  getProvider(id){if(!this.providers.has(id))this.providers.set(id,{id:id,name:id,state:'CLOSED',failures:0,lastFailure:null,lastSuccess:null,openedAt:null,totalCalls:0,totalSuccess:0,totalFailures:0});return this.providers.get(id);}

  getHealthy(exclude){
    const h=[];for(const[i,p]of this.providers){if(i===exclude)continue;if(p.state==='CLOSED'||p.state==='HALF_OPEN')h.push({id:i,...p,score:this.score(p)});}
    h.sort((a,b)=>b.score-a.score);return h;
  }
  score(p){let s=100;if(p.state==='HALF_OPEN')s-=30;s-=p.failures*10;if(p.totalCalls>0)s+=Math.round((p.totalSuccess/p.totalCalls)*20);return Math.max(0,Math.min(100,s));}

  async logState(p,ch,rs){this.stateLog.push({ts:new Date().toISOString(),provider:p.name,change:ch,reason:rs});try{await pool.query("INSERT INTO agent_execution_logs(agent_name,action,input,output,status,created_at)VALUES($1,$2,$3,$4,'completed',NOW())",['cb_state',ch,JSON.stringify({id:p.id,r:rs}),JSON.stringify({s:p.state,f:p.failures})]);}catch(e){}}
  async syncDB(p){try{await pool.query("UPDATE inference_providers SET status=$1,last_checked=NOW() WHERE id=$2",[p.state.toLowerCase(),p.id]);}catch(e){}}

  async health(){let c=0,o=0,h=0;for(const[,p]of this.providers){if(p.state==='CLOSED')c++;else if(p.state==='OPEN')o++;else if(p.state==='HALF_OPEN')h++;}
  return{n:this.name,v:this.version,p:{t:this.providers.size,c,o,h},cfg:{t:this.FAILURE_THRESHOLD,to:this.RECOVERY_TIMEOUT_MS},log:this.stateLog.slice(-5)};}

  async simulateFail(pid){
    console.log('SIM FAIL:',pid);
    for(let i=0;i<this.FAILURE_THRESHOLD;i++)await this.recordFailure(pid,'sim_'+i);
    return this.allowRequest(pid);
  }
}

const cb=new CircuitBreaker();

cb.init().then(ok=>{
  if(!ok){console.error('FAIL');process.exit(1);}
  console.log('=== CIRCUIT BREAKER TEST ===');
  cb.allowRequest('groq').then(r=>{console.log('Test1 groq:',r.allowed?'OK':'NO',r.reason);
  return cb.simulateFail('groq');}).then(()=>{
  return cb.health();}).then(h=>{
    console.log('Health:',JSON.stringify(h,null,2));
    console.log('CIRCUIT BREAKER OPERATIONAL!');
    process.exit(0);
  });
});

export default cb;
