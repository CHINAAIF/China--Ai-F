
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = msg => console.log('['+new Date().toISOString()+'] '+msg);

const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_intel_raw_status ON intelligence_raw(filter_status)',
  'CREATE INDEX IF NOT EXISTS idx_intel_raw_agent ON intelligence_raw(agent_name)',
  'CREATE INDEX IF NOT EXISTS idx_brain_working_quarantine ON brain_working_memory(quarantine, quarantine_until)',
  'CREATE INDEX IF NOT EXISTS idx_brain_working_domain ON brain_working_memory(domain)',
  'CREATE INDEX IF NOT EXISTS idx_model_accuracy_key ON model_accuracy_registry(model_key)',
  'CREATE INDEX IF NOT EXISTS idx_agent_logs_name ON agent_execution_logs(agent_name, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_agent_logs_status ON agent_execution_logs(status)',
  'CREATE INDEX IF NOT EXISTS idx_pricing_tiers_model ON model_pricing_tiers(model_id)',
  'CREATE INDEX IF NOT EXISTS idx_benchmarks_model ON model_benchmarks(model_id)',
  'CREATE INDEX IF NOT EXISTS idx_benchmarks_def ON model_benchmarks(benchmark_definition_id)',
  'CREATE INDEX IF NOT EXISTS idx_source_rep_domain ON source_reputation(domain_url)',
  'CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_priority ON brain_knowledge_gaps(priority DESC, filled)',
  'CREATE INDEX IF NOT EXISTS idx_pricing_history_model ON pricing_history(model_id)',
  'CREATE INDEX IF NOT EXISTS idx_models_vendor ON models(vendor_id)',
  'CREATE INDEX IF NOT EXISTS idx_models_type ON models(model_type, status)',
];

log('=== STEP 1: INDEXES ===');
for(const sql of indexes){
  try{ await pool.query(sql); log('OK: '+sql.split(' ON ')[1]); }
  catch(e){ log('ERR: '+e.message); }
}

log('\n=== STEP 2: VENDORS & MODELS ===');
const vendorRes = await pool.query('SELECT id, slug FROM vendors');
const vendorMap = {};
vendorRes.rows.forEach(x => vendorMap[x.slug] = x.id);

const existingRes = await pool.query('SELECT slug FROM models');
const existingSlugs = new Set(existingRes.rows.map(x => x.slug));

const newModels = [
  {slug:'llama-3-1-405b', name:{en:'Llama 3.1 405B',ar:'لاما 3.1 405B'}, vendor:'meta', type:'llm', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de','es','it','pt']},
  {slug:'llama-3-2-90b', name:{en:'Llama 3.2 90B Vision',ar:'لاما 3.2 90B بصري'}, vendor:'meta', type:'multimodal', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de']},
  {slug:'llama-3-2-11b', name:{en:'Llama 3.2 11B Vision',ar:'لاما 3.2 11B بصري'}, vendor:'meta', type:'multimodal', context:128000, open:true, status:'active', langs:['en','fr','de','es']},
  {slug:'llama-3-2-3b', name:{en:'Llama 3.2 3B',ar:'لاما 3.2 3B'}, vendor:'meta', type:'llm', context:128000, open:true, status:'active', langs:['en','de','fr','it','pt']},
  {slug:'llama-3-2-1b', name:{en:'Llama 3.2 1B',ar:'لاما 3.2 1B'}, vendor:'meta', type:'llm', context:128000, open:true, status:'active', langs:['en','de','fr']},
  {slug:'mistral-7b-v03', name:{en:'Mistral 7B v0.3',ar:'ميسترال 7B'}, vendor:'mistral', type:'llm', context:32768, open:true, status:'active', langs:['en','fr','de','es','it']},
  {slug:'mixtral-8x7b', name:{en:'Mixtral 8x7B',ar:'ميكسترال 8x7B'}, vendor:'mistral', type:'llm', context:32768, open:true, status:'active', langs:['en','fr','de','es','it']},
  {slug:'mixtral-8x22b', name:{en:'Mixtral 8x22B',ar:'ميكسترال 8x22B'}, vendor:'mistral', type:'llm', context:65536, open:true, status:'active', langs:['en','fr','de','es','it']},
  {slug:'phi-3-5-mini', name:{en:'Phi-3.5 Mini',ar:'فاي 3.5 ميني'}, vendor:'microsoft', type:'llm', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de','es']},
  {slug:'phi-3-medium', name:{en:'Phi-3 Medium 14B',ar:'فاي 3 ميديوم'}, vendor:'microsoft', type:'llm', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de']},
  {slug:'gemma-2-27b', name:{en:'Gemma 2 27B',ar:'جيما 2 27B'}, vendor:'google', type:'llm', context:8192, open:true, status:'active', langs:['en','ar','zh','fr','de','es']},
  {slug:'gemma-2-9b', name:{en:'Gemma 2 9B',ar:'جيما 2 9B'}, vendor:'google', type:'llm', context:8192, open:true, status:'active', langs:['en','fr','de','es']},
  {slug:'gemma-2-2b', name:{en:'Gemma 2 2B',ar:'جيما 2 2B'}, vendor:'google', type:'llm', context:8192, open:true, status:'active', langs:['en']},
  {slug:'gemma-3-27b', name:{en:'Gemma 3 27B',ar:'جيما 3 27B'}, vendor:'google', type:'multimodal', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de','es']},
  {slug:'gemma-3-12b', name:{en:'Gemma 3 12B',ar:'جيما 3 12B'}, vendor:'google', type:'multimodal', context:128000, open:true, status:'active', langs:['en','ar','fr','de']},
  {slug:'gemma-3-4b', name:{en:'Gemma 3 4B',ar:'جيما 3 4B'}, vendor:'google', type:'multimodal', context:128000, open:true, status:'active', langs:['en','fr','de']},
  {slug:'gemma-3-1b', name:{en:'Gemma 3 1B',ar:'جيما 3 1B'}, vendor:'google', type:'llm', context:32000, open:true, status:'active', langs:['en']},
  {slug:'qwen-2-5-72b', name:{en:'Qwen2.5 72B',ar:'كيوين 2.5 72B'}, vendor:'alibaba', type:'llm', context:128000, open:true, status:'active', langs:['en','zh','ar','fr','de','es']},
  {slug:'qwen-2-5-32b', name:{en:'Qwen2.5 32B',ar:'كيوين 2.5 32B'}, vendor:'alibaba', type:'llm', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'qwen-2-5-14b', name:{en:'Qwen2.5 14B',ar:'كيوين 2.5 14B'}, vendor:'alibaba', type:'llm', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'qwen-2-5-7b', name:{en:'Qwen2.5 7B',ar:'كيوين 2.5 7B'}, vendor:'alibaba', type:'llm', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'qwen-2-5-coder-32b', name:{en:'Qwen2.5 Coder 32B',ar:'كيوين 2.5 كودر'}, vendor:'alibaba', type:'code', context:128000, open:true, status:'active', langs:['en','zh']},
  {slug:'qwen-2-5-vl-72b', name:{en:'Qwen2.5 VL 72B',ar:'كيوين 2.5 بصري'}, vendor:'alibaba', type:'multimodal', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'deepseek-r1', name:{en:'DeepSeek R1',ar:'ديب سيك R1'}, vendor:'deepseek', type:'reasoning', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'deepseek-r1-distill-llama-70b', name:{en:'DeepSeek R1 Distill Llama 70B',ar:'ديب سيك R1 لاما'}, vendor:'deepseek', type:'reasoning', context:128000, open:true, status:'active', langs:['en','zh']},
  {slug:'deepseek-r1-distill-qwen-32b', name:{en:'DeepSeek R1 Distill Qwen 32B',ar:'ديب سيك R1 كيوين'}, vendor:'deepseek', type:'reasoning', context:128000, open:true, status:'active', langs:['en','zh']},
  {slug:'deepseek-coder-v2', name:{en:'DeepSeek Coder V2',ar:'ديب سيك كودر V2'}, vendor:'deepseek', type:'code', context:128000, open:true, status:'active', langs:['en','zh']},
  {slug:'deepseek-v2-5', name:{en:'DeepSeek V2.5',ar:'ديب سيك V2.5'}, vendor:'deepseek', type:'llm', context:128000, open:true, status:'active', langs:['en','zh','ar']},
  {slug:'aya-expanse-32b', name:{en:'Aya Expanse 32B',ar:'آيا اكسبانس 32B'}, vendor:'cohere', type:'llm', context:128000, open:true, status:'active', langs:['en','ar','zh','fr','de','es','pt','ru']},
  {slug:'aya-expanse-8b', name:{en:'Aya Expanse 8B',ar:'آيا اكسبانس 8B'}, vendor:'cohere', type:'llm', context:8192, open:true, status:'active', langs:['en','ar','zh','fr','de','es']},
  {slug:'nemotron-4-340b', name:{en:'Nemotron-4 340B',ar:'نيموترون 4 340B'}, vendor:'nvidia', type:'llm', context:4096, open:true, status:'active', langs:['en','zh','fr','de']},
  {slug:'nemotron-mini-4b', name:{en:'Nemotron Mini 4B',ar:'نيموترون ميني 4B'}, vendor:'nvidia', type:'llm', context:4096, open:true, status:'active', langs:['en']},
  {slug:'amazon-nova-pro', name:{en:'Amazon Nova Pro',ar:'أمازون نوفا برو'}, vendor:'amazon', type:'multimodal', context:300000, open:false, status:'active', langs:['en','ar','zh','fr','de','es','pt','ja','ko']},
  {slug:'amazon-nova-lite', name:{en:'Amazon Nova Lite',ar:'أمازون نوفا لايت'}, vendor:'amazon', type:'multimodal', context:300000, open:false, status:'active', langs:['en','ar','zh','fr','de']},
  {slug:'amazon-nova-micro', name:{en:'Amazon Nova Micro',ar:'أمازون نوفا ميكرو'}, vendor:'amazon', type:'llm', context:128000, open:false, status:'active', langs:['en','ar','zh','fr']},
  {slug:'samsung-gauss2', name:{en:'Samsung Gauss2',ar:'سامسونج غاوس 2'}, vendor:'samsung', type:'llm', context:8192, open:false, status:'active', langs:['en','ko','zh']},
];

let ok=0,skip=0,err=0;
for(const m of newModels){
  try{
    if(existingSlugs.has(m.slug)){skip++;continue;}
    if(!vendorMap[m.vendor]){log('NO_VENDOR:'+m.vendor);err++;continue;}
    await pool.query(
      'INSERT INTO models(slug,name,vendor_id,model_type,context_window,is_open_source,status,supported_languages) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [m.slug,m.name,vendorMap[m.vendor],m.type,m.context,m.open,m.status,m.langs]
    );
    log('OK: '+m.slug);
    ok++;
  }catch(e){log('ERR '+m.slug+': '+e.message);err++;}
}

log('\n=== STEP 3: PRICING ===');
const allModels = await pool.query('SELECT id, slug FROM models');
const modelMap = {};
allModels.rows.forEach(x => modelMap[x.slug] = x.id);

const existTiers = await pool.query('SELECT model_id, tier_name FROM model_pricing_tiers');
const tierSet = new Set(existTiers.rows.map(x=>x.model_id+'_'+x.tier_name));

const pricing = [
  ['llama-3-1-405b','input',0.000000900,'global'],
  ['llama-3-1-405b','output',0.000000900,'global'],
  ['llama-3-2-90b','input',0.000000900,'global'],
  ['llama-3-2-90b','output',0.000000900,'global'],
  ['llama-3-2-11b','input',0.000000180,'global'],
  ['llama-3-2-11b','output',0.000000180,'global'],
  ['llama-3-2-3b','input',0.000000060,'global'],
  ['llama-3-2-3b','output',0.000000060,'global'],
  ['llama-3-2-1b','input',0.000000040,'global'],
  ['llama-3-2-1b','output',0.000000040,'global'],
  ['mistral-7b-v03','input',0.000000050,'global'],
  ['mistral-7b-v03','output',0.000000050,'global'],
  ['mixtral-8x7b','input',0.000000240,'global'],
  ['mixtral-8x7b','output',0.000000240,'global'],
  ['mixtral-8x22b','input',0.000000900,'global'],
  ['mixtral-8x22b','output',0.000000900,'global'],
  ['phi-3-5-mini','input',0.000000050,'global'],
  ['phi-3-5-mini','output',0.000000050,'global'],
  ['phi-3-medium','input',0.000000100,'global'],
  ['phi-3-medium','output',0.000000100,'global'],
  ['gemma-2-27b','input',0.000000270,'global'],
  ['gemma-2-27b','output',0.000000270,'global'],
  ['gemma-2-9b','input',0.000000200,'global'],
  ['gemma-2-9b','output',0.000000200,'global'],
  ['gemma-2-2b','input',0.000000050,'global'],
  ['gemma-2-2b','output',0.000000050,'global'],
  ['gemma-3-27b','input',0.000000300,'global'],
  ['gemma-3-27b','output',0.000000300,'global'],
  ['gemma-3-12b','input',0.000000100,'global'],
  ['gemma-3-12b','output',0.000000100,'global'],
  ['gemma-3-4b','input',0.000000040,'global'],
  ['gemma-3-4b','output',0.000000040,'global'],
  ['gemma-3-1b','input',0.000000010,'global'],
  ['gemma-3-1b','output',0.000000010,'global'],
  ['qwen-2-5-72b','input',0.000000290,'global'],
  ['qwen-2-5-72b','output',0.000000290,'global'],
  ['qwen-2-5-32b','input',0.000000150,'global'],
  ['qwen-2-5-32b','output',0.000000150,'global'],
  ['qwen-2-5-14b','input',0.000000080,'global'],
  ['qwen-2-5-14b','output',0.000000080,'global'],
  ['qwen-2-5-7b','input',0.000000040,'global'],
  ['qwen-2-5-7b','output',0.000000040,'global'],
  ['qwen-2-5-coder-32b','input',0.000000150,'global'],
  ['qwen-2-5-coder-32b','output',0.000000150,'global'],
  ['qwen-2-5-vl-72b','input',0.000000400,'global'],
  ['qwen-2-5-vl-72b','output',0.000000400,'global'],
  ['deepseek-r1','input',0.000000550,'non_china'],
  ['deepseek-r1','output',0.000002190,'non_china'],
  ['deepseek-r1-distill-llama-70b','input',0.000000750,'global'],
  ['deepseek-r1-distill-llama-70b','output',0.000000990,'global'],
  ['deepseek-r1-distill-qwen-32b','input',0.000000400,'global'],
  ['deepseek-r1-distill-qwen-32b','output',0.000000400,'global'],
  ['deepseek-coder-v2','input',0.000000140,'non_china'],
  ['deepseek-coder-v2','output',0.000000280,'non_china'],
  ['deepseek-v2-5','input',0.000000140,'non_china'],
  ['deepseek-v2-5','output',0.000000280,'non_china'],
  ['aya-expanse-32b','input',0.000000500,'global'],
  ['aya-expanse-32b','output',0.000001500,'global'],
  ['aya-expanse-8b','input',0.000000500,'global'],
  ['aya-expanse-8b','output',0.000001500,'global'],
  ['nemotron-4-340b','input',0.000004200,'global'],
  ['nemotron-4-340b','output',0.000004200,'global'],
  ['nemotron-mini-4b','input',0.000000200,'global'],
  ['nemotron-mini-4b','output',0.000000200,'global'],
  ['amazon-nova-pro','input',0.000000800,'global'],
  ['amazon-nova-pro','output',0.000003200,'global'],
  ['amazon-nova-lite','input',0.000000060,'global'],
  ['amazon-nova-lite','output',0.000000240,'global'],
  ['amazon-nova-micro','input',0.000000035,'global'],
  ['amazon-nova-micro','output',0.000000140,'global'],
];

let pok=0,perr=0;
for(const [slug,tier,price,avail] of pricing){
  try{
    const mid = modelMap[slug];
    if(!mid) continue;
    if(tierSet.has(mid+'_'+tier)) continue;
    await pool.query(
      'INSERT INTO model_pricing_tiers(model_id,tier_name,pricing_model,currency,price,availability,active) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [mid,tier,'per_token','USD',price,avail,true]
    );
    pok++;
  }catch(e){log('ERR price '+slug+': '+e.message);perr++;}
}

const mc = await pool.query('SELECT COUNT(*) FROM models');
const mo = await pool.query('SELECT COUNT(*) FROM models WHERE is_open_source=true');
const tc = await pool.query('SELECT COUNT(*) FROM model_pricing_tiers');
const byVendor = await pool.query('SELECT v.name, COUNT(m.id) as c FROM models m JOIN vendors v ON v.id=m.vendor_id GROUP BY v.name ORDER BY c DESC');

log('\n=== FINAL VERIFY ===');
log('models total: '+mc.rows[0].count+' | open_source: '+mo.rows[0].count);
log('pricing_tiers: '+tc.rows[0].count);
log('inserted: ok='+ok+' skip='+skip+' err='+err);
log('pricing: ok='+pok+' err='+perr);
log('\nby vendor:');
byVendor.rows.forEach(x=>log('  '+x.name+': '+x.c));
await pool.end();
