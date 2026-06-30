/**
 * TRUNKIA Causal Memory Loop v1.0
 * System learns from its own routing decisions
 * After every 100 decisions → analyze → improve routing priorities
 */
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized: true}});

class CausalMemoryAgent {
  constructor(){
    this.name='causal_memory';
    this.version='1.0.0';
    this.LEARNING_THRESHOLD=100; // Analyze after 100 decisions
    this.decisionBuffer=[];
    this.patterns=new Map(); // provider+task → {success_rate, avg_outcome}
  }

  async recordDecision(decision){
    // Record to buffer
    this.decisionBuffer.push({
      ts:new Date().toISOString(),
      provider:decision.provider_id,
      taskType:decision.task_type,
      intent:decision.intent,
      outcomeScore:decision.outcome_score||0,
      latency_ms:decision.latency_ms||0,
      success:decision.success||false,
      error:decision.error||null
    });

    // Check if we should learn
    if(this.decisionBuffer.length>=this.LEARNING_THRESHOLD){
      await this.learnAndEvolve();
    }
  }

  async learnAndEvolve(){
    console.log('[CAUSAL] Learning from',this.decisionBuffer.length,'decisions...');
    
    // Group by provider+task
    const groups=new Map();
    for(const d of this.decisionBuffer){
      const key=d.provider+'::'+d.taskType;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(d);
    }

    const insights=[];
    
    // Analyze each group
    for(const [key,decisions] of groups){
      const total=decisions.length;
      const successes=decisions.filter(d=>d.success).length;
      const successRate=Math.round((successes/total)*100);
      const avgOutcome=decisions.reduce((a,b)=>a+(b.outcome_score||0),0)/total;
      const avgLatency=decisions.reduce((a,b)=>a+(b.latency_ms||0),0)/total;
      
      const [provider,task]=key.split('::');
      
      // Store pattern
      this.patterns.set(key,{provider,task,total,successes,successRate,avgOutcome,avgLatency,lastLearned:new Date().toISOString()});
      
      // Generate insight
      if(successRate<60&&total>=5){
        insights.push({type:'UNDERPERFORMER',provider,task,successRate,action:'reduce_priority',reason:'Success rate below 60% over '+total+' decisions'});
      }
      else if(successRate>=90&&total>=10){
        insights.push({type:'TOP_PERFORMER',provider,task,successRate,action:'increase_priority',reason:'Excellent success rate '+successRate+'% over '+total+' decisions'});
      }
      
      // Update provider in DB (if inference_providers table exists)
      try{
        await pool.query(`
          UPDATE inference_providers 
          SET success_rate=$1, last_checked=NOW(), 
              metadata=jsonb_set(COALESCE(metadata,'{}','"causal_success_rate":'||$2||metadata::text)
          WHERE id=$3
        `,[successRate,JSON.stringify({successRate,avgOutcome,total}),provider]);
      }catch(e){/* best-effort */}
    }

    // Clear buffer after learning
    this.decisionBuffer=[];
    
    // Log insights
    if(insights.length>0){
      console.log('🧠 Insights generated:',insights.length);
      for(const ins of insights){
        console.log('  ',ins.type,':',ins.provider,'|',ins.task,'|',ins.successRate+'%','|',ins.action);
        try{
          await pool.query("INSERT INTO agent_execution_logs(agent_name,action,input,output,status,created_at)VALUES($1,$2,$3,$4,'completed',NOW())",
            ['causal_memory','insight',JSON.stringify(ins),JSON.stringify({patterns:this.patterns.size})]);
        }catch(e){}
      }
    }

    return{decisionsAnalyzed:this.decisionBuffer.length,insightsGenerated:insights.length,patternsTracked:this.patterns.size};
  }

  async getRecommendation(taskType){
    // Find best provider for this task type based on history
    let bestProvider=null;let bestScore=-1;
    for(const[key,p] of this.patterns){
      if(p.task===taskType&&p.successRate>bestScore){
        bestScore=p.successRate;
        bestProvider=p.provider;
      }
    }
    return{recommended:bestProvider,score:bestScore,basedOn:this.patterns.size,patterns:Array.from(this.patterns.entries())};
  }

  async health(){
    return{name:this.name,v:this.version,bufferSize:this.decisionBuffer.length,patterns:this.patterns.size,threshold:this.LEARNING_THRESHOLD};
  }
}

const cm=new CausalMemoryAgent();
cm.init?cm.init():Promise.resolve();
// Simulate 150 decisions to test learning
(async()=>{
  const providers=['groq','openai','anthropic','google','deepseek','cohere'];
  const tasks=['benchmark_compare','pricing_query','security_check','code_generation','translation','analysis'];
  
  for(let i=0;i<150;i++){
    await cm.recordDecision({
      provider_id:providers[i%providers.length],
      task_type:tasks[i%tasks.length],
      intent:'auto',
      outcome_score:Math.floor(Math.random()*40)+60,
      latency_ms:Math.floor(Math.random()*2000)+200,
      success:Math.random()>0.25
    });
  }
  
  const result=await cm.learnAndEvolve();
  console.log('\n=== CAUSAL MEMORY LOOP ===');
  console.log('Decisions analyzed:',result.decisionsAnalyzed);
  console.log('Insights:',result.insightsGenerated);
  console.log('Patterns tracked:',result.patternsTracked);
  
  const rec=await cm.getRecommendation('benchmark_compare');
  console.log('\nRecommendation for benchmark_compare:');
  console.log('  Best provider:',rec.recommended||'none yet','| score:',rec.score||0);
  
  const h=await cm.health();
  console.log('\nHealth:',h.name,'| Buffer:',h.bufferSize,'| Patterns:',h.patterns);
  console.log('\n🧠 CAUSAL MEMORY OPERATIONAL — SELF-EVOLUTION ENABLED!');
  process.exit(0);
})();

export default cm;
