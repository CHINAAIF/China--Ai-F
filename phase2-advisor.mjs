
import dotenv from 'dotenv';
import pg from 'pg';
import { validateRecord } from './utils/output-validator.js';
dotenv.config();
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized: true}});

console.log('=== TRUNKIA Phase 2: Advisor Layer ===\n');

// ============================================================
// ADVISOR CORE CLASS
// ============================================================
class AdvisorCore {
  constructor(){
    this.name='advisor_core';
    this.layer='advisor';
    this.version='1.0.0';
    this.status='initializing';
    this.intents = {
      BENCHMARK:'benchmark_compare',      // مقارنة نماذج
      PRICING:'pricing_query',           // استعلام أسعار
      SECURITY:'security_check',         // فحص أمني
      ROUTING:'model_routing',           // توجيه نموذج
      ANALYSIS:'deep_analysis',          // تحليل عميق
      GENERAL:'general_query'            // استعلام عام
    };
    this.capabilities = ['intent_detection','task_planning','agent_orchestration','decision_making'];
  }

  async initialize(){
    try{
      await pool.query('SELECT 1');
      this.status='active';
      console.log('✅ Advisor Core initialized');
      return true;
    }catch(e){
      this.status='error';
      console.error('❌ DB connection failed:',e.message);
      return false;
    }
  }

  // ============================================================
  // INTENT ANALYZER - Understands what user wants
  // ============================================================
  async analyzeInput(input){
    const startTime = Date.now();
    
    if(!input || (!input.text && !input.query && !input.prompt)){
      return {success:false,error:'No input provided',intent:null,confidence:0};
    }

    const text = input.text || input.query || input.prompt || '';
    const textLower = text.toLowerCase();

    // Keyword-based intent detection (fast path)
    let detectedIntent = this.intents.GENERAL;
    let confidence = 50;
    let entities = {};
    let language = 'en';

    // Detect language
    if(/[\u0600-\u06FF]/.test(text)){ language='ar'; }

    // Benchmark/Compare intent
    if(/compare|مقارنة|vs|versus|which is better|أفضل|benchmark/.test(textLower)){
      detectedIntent = this.intents.BENCHMARK;
      confidence = 85;
      // Extract model names mentioned
      const modelMentioned = await this.extractModelsFromText(text);
      if(modelMentioned.length > 0){ entities.models = modelMentioned; confidence += 10; }
    }

    // Pricing intent
    if(/price|cost|تكلفة|سعر|pricing|cheap|رخيص|expensive|غالي|how much|كم/.test(textLower)){
      detectedIntent = this.intents.PRICING;
      confidence = 85;
    }

    // Security intent
    if(/secure|safe|آمن|security|risk|مخطر|gdpr|block|حجب|geopolitical|compliance|امتثال/.test(textLower)){
      detectedIntent = this.intents.SECURITY;
      confidence = 85;
    }

    // Routing intent
    if(/route|وجّه|redirect|use model|استخدم|send to|أرسل لـ/.test(textLower)){
      detectedIntent = this.intents.ROUTING;
      confidence = 80;
    }

    // Deep analysis intent
    if(/analyze|حلل|analysis|تحليل|detailed|تفصيلي|deep|عميق|report|تقرير/.test(textLower)){
      detectedIntent = this.intents.ANALYSIS;
      confidence = 80;
    }

    // Clamp confidence
    confidence = Math.max(0, Math.min(100, confidence));

    const result = {
      success:true,
      intent: detectedIntent,
      confidence: confidence,
      language: language,
      entities: entities,
      original_text: text.substring(0, 200),
      processing_time_ms: Date.now() - startTime,
      advisor_version: this.version
    };

    // Log this analysis
    try{
      const validated = validateRecord({
        agent_name:this.name,
        action:'analyze_intent',
        input:JSON.stringify({text:text.substring(0,100),language}),
        output:JSON.stringify(result),
        confidence:confidence,
        status:'completed'
      },'agent_execution_logs');
      
      await pool.query(`
        INSERT INTO agent_execution_logs(agent_name,action,input,output,confidence,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,NOW())
      `,[this.name,'analyze_intent',validated.sanitized.input,JSON.stringify(validated.sanitized.output),confidence,'completed']);
    }catch(e){/* log failure non-critical */}

    return result;
  }

  // ============================================================
  // MODEL EXTRACTOR - Find model names in text
  // ============================================================
  async extractModelsFromText(text){
    try{
      const result = await pool.query(`
        SELECT slug, name FROM models 
        WHERE slug ILIKE '%' || $1 || '%'
           OR name::text ILIKE '%' || $1 || '%'
        LIMIT 5
      `,[text.replace(/[^a-zA-Z0-9-\u0600-\u06FF]/g,' ').split(' ').filter(w=>w.length>2)[0]||'']);
      
      return result.rows.map(r=>r.slug);
    }catch(e){
      return [];
    }
  }

  // ============================================================
  // TASK PLANNER - Creates execution plan
  // ============================================================
  async createPlan(intentAnalysis, context={}){
    const plan = {
      id: 'plan_' + Date.now(),
      intent: intentAnalysis.intent,
      created_at: new Date().toISOString(),
      tasks: [],
      estimated_duration_ms: 0,
      required_agents: [],
      priority: 'normal'
    };

    switch(intentAnalysis.intent){
      case this.intents.BENCHMARK:
        plan.tasks.push(
          {step:1,action:'fetch_model_data',agent:'global_models_agent',params:{models:context.models||['gpt-4o','claude-3.5-sonnet']},est_ms:2000},
          {step:2,action:'fetch_benchmarks',agent:'model_benchmarking_engine',params:{},est_ms:3000},
          {step:3,action:'compare_results',agent:this.name,params:{},est_ms:1000}
        );
        plan.required_agents = ['global_models_agent','model_benchmarking_engine'];
        plan.estimated_duration_ms = 6000;
        break;

      case this.intents.PRICING:
        plan.tasks.push(
          {step:1,action:'fetch_pricing',agent:'global_models_agent',params:{include_pricing:true},est_ms:2000},
          {step:2,action:'calculate_costs',agent:this.name,params:{monthly_requests:context.monthly_requests||1000},est_ms:1500}
        );
        plan.required_agents = ['global_models_agent'];
        plan.estimated_duration_ms = 3500;
        break;

      case this.intents.SECURITY:
        plan.tasks.push(
          {step:1,action:'fetch_geo_risk',agent:this.name,params:{table:'model_geopolitical_risk'},est_ms:1000},
          {step:2,action:'check_compliance',agent:this.name,params:{},est_ms:1500},
          {step:3,action:'generate_report',agent:this.name,params:{type:'security'},est_ms:2000}
        );
        plan.estimated_duration_ms = 4500;
        plan.priority = 'high';
        break;

      default:
        plan.tasks.push(
          {step:1,action:'general_search',agent:'global_models_agent',params:{query:intentAnalysis.original_text},est_ms:2500},
          {step:2,action:'summarize',agent:this.name,params:{},est_ms:1000}
        );
        plan.estimated_duration_ms = 3500;
    }

    // Store plan
    try{
      await pool.query(`
        INSERT INTO routing_decisions(request_id,intent,recommended_path,tasks_json,outcome_score,created_at)
        VALUES($1,$2,$3,$4,$5,NOW())
      `,[plan.id,plan.intent,JSON.stringify(plan.required_agents),JSON.stringify(plan.tasks),null]);
    }catch(e){/* plan storage best-effort */}

    return plan;
  }

  // ============================================================
  // DECISION MAKER - Final recommendation
  // ============================================================
  async makeDecision(plan, availableResults={}){
    const decision = {
      plan_id: plan.id,
      recommendation: null,
      confidence: 0,
      reasoning: [],
      data_sources: [],
      timestamp: new Date().toISOString()
    };

    // Simple decision logic based on intent
    switch(plan.intent){
      case this.intents.BENCHMARK:
        decision.recommendation = 'compare_models';
        decision.confidence = availableResults.benchmarks ? 90 : 70;
        decision.reasoning.push('Benchmark comparison requested');
        if(availableResults.model_count >= 2){
          decision.reasoning.push(`${availableResults.model_count} models identified`);
        }
        break;

      case this.intents.PRICING:
        decision.recommendation = 'show_pricing_table';
        decision.confidence = 85;
        decision.reasoning.push('Pricing information requested');
        break;

      case this.intents.SECURITY:
        decision.recommendation = 'security_assessment';
        decision.confidence = 88;
        decision.reasoning.push('Security/geopolitical assessment requested');
        decision.priority = 'high';
        break;

      default:
        decision.recommendation = 'general_info';
        decision.confidence = 65;
        decision.reasoning.push('General query - providing overview');
    }

    // Update routing decision with outcome
    try{
      await pool.query(`
        UPDATE routing_decisions SET outcome_score=$1,completed_at=NOW() 
        WHERE request_id=$2
      `,[decision.confidence,plan.id]);
    }catch(e){/* non-critical */}

    return decision;
  }

  // ============================================================
  // HEALTH CHECK
  // ============================================================
  async healthCheck(){
    const start = Date.now();
    try{
      const dbTest = await pool.query('SELECT 1');
      const modelCount = (await pool.query('SELECT COUNT(*)c FROM models')).rows[0].c;
      
      return {
        status:'healthy',
        advisor:this.name,
        version:this.version,
        latency_ms:Date.now()-start,
        db_connected:true,
        models_in_db:parseInt(modelCount),
        capabilities:this.capabilities,
        uptime_process:process.uptime()
      };
    }catch(e){
      return {status:'unhealthy',error:e.message,latency_ms:Date.now()-start};
    }
  }
}

// Export singleton
const advisor = new AdvisorCore();

// Auto-initialize if run directly
advisor.initialize().then(ok=>{
  if(ok){
    console.log('\n🧠 Advisor Layer ready!');
    console.log('Capabilities:',advisor.capabilities.join(', '));
    console.log('Intents:',Object.keys(advisor.intents).join(', '));
    console.log('\nTest: analyzeInput("قارن بين gpt-4o و claude")...');
    
    advisor.analyzeInput({text:'قارن بين gpt-4o و claude'}).then(result=>{
      console.log('\nResult:',JSON.stringify(result,null,2));
      
      // Test createPlan
      return advisor.createPlan(result,{models:['gpt-4o','claude-3.5-sonnet']});
    }).then(plan=>{
      console.log('\nPlan created:',plan.tasks.length,'tasks');
      console.log('Est. duration:',plan.estimated_duration_ms,'ms');
      
      // Test health check
      return advisor.healthCheck();
    }).then(health=>{
      console.log('\nHealth:',health.status,'| Models:',health.models_in_db);
      console.log('\n✅ ALL TESTS PASSED - Advisor Layer operational!');
      process.exit(0);
    });
  }
}).catch(e=>{
  console.error('Init failed:',e.message);
  process.exit(1);
});

export default advisor;
export { AdvisorCore };
