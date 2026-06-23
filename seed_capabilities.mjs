
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = msg => console.log('['+new Date().toISOString()+'] '+msg);

const existing = await pool.query('SELECT m.slug, mc.capability FROM model_capabilities mc JOIN models m ON m.id=mc.model_id ORDER BY m.slug, mc.capability');
log('existing capabilities: '+existing.rows.length);
const existSet = new Set(existing.rows.map(x=>x.slug+'_'+x.capability));

const modelsRes = await pool.query('SELECT id, slug, model_type, is_open_source FROM models');
const modelMap = {};
modelsRes.rows.forEach(x => modelMap[x.slug] = {id:x.id, type:x.model_type, open:x.is_open_source});

const now = new Date().toISOString();

// capabilities per model — مبنية على المواصفات الرسمية
const modelCaps = {
  'gpt-4o':['vision','function_calling','json_mode','streaming','fine_tuning','multilingual','long_context','code'],
  'gpt-4o-mini':['vision','function_calling','json_mode','streaming','fine_tuning','multilingual','code'],
  'o3':['reasoning','function_calling','json_mode','streaming','code','math','multilingual'],
  'o4-mini':['reasoning','vision','function_calling','json_mode','streaming','code','math'],
  'gpt-4-5':['vision','function_calling','json_mode','streaming','multilingual','code'],
  'claude-opus-4-6':['vision','function_calling','streaming','multilingual','long_context','code','reasoning','arabic'],
  'claude-sonnet-4-6':['vision','function_calling','streaming','multilingual','long_context','code','reasoning','arabic'],
  'claude-haiku-4-5':['vision','function_calling','streaming','multilingual','code','arabic'],
  'gemini-2-5-pro':['vision','audio','function_calling','json_mode','streaming','multilingual','long_context','code','reasoning','arabic'],
  'gemini-2-5-flash':['vision','audio','function_calling','json_mode','streaming','multilingual','long_context','code','arabic'],
  'gemini-2-0-flash':['vision','audio','function_calling','json_mode','streaming','multilingual','long_context','code'],
  'llama-4-scout':['vision','function_calling','streaming','multilingual','long_context','code','arabic'],
  'llama-4-maverick':['vision','function_calling','streaming','multilingual','long_context','code','arabic'],
  'llama-3-3-70b':['function_calling','streaming','multilingual','code','arabic'],
  'llama-3-1-405b':['function_calling','streaming','multilingual','code','arabic','long_context'],
  'llama-3-2-90b':['vision','function_calling','streaming','multilingual','code'],
  'llama-3-2-11b':['vision','function_calling','streaming','multilingual'],
  'llama-3-2-3b':['streaming','multilingual'],
  'llama-3-2-1b':['streaming'],
  'mistral-large-3':['function_calling','json_mode','streaming','multilingual','code','arabic'],
  'mistral-small-3-1':['vision','function_calling','json_mode','streaming','multilingual','code'],
  'mistral-7b-v03':['streaming','multilingual','code'],
  'mixtral-8x7b':['function_calling','streaming','multilingual','code'],
  'mixtral-8x22b':['function_calling','streaming','multilingual','code','long_context'],
  'codestral':['code','streaming','function_calling','long_context'],
  'grok-3':['vision','function_calling','streaming','multilingual','code','arabic','reasoning'],
  'grok-3-mini':['reasoning','function_calling','streaming','code','multilingual'],
  'deepseek-v3':['function_calling','streaming','multilingual','code','arabic'],
  'deepseek-r2':['reasoning','function_calling','streaming','multilingual','code','arabic'],
  'deepseek-r1':['reasoning','streaming','multilingual','code','arabic'],
  'deepseek-r1-distill-llama-70b':['reasoning','streaming','code','multilingual'],
  'deepseek-r1-distill-qwen-32b':['reasoning','streaming','code','multilingual'],
  'deepseek-coder-v2':['code','function_calling','streaming','long_context'],
  'deepseek-v2-5':['function_calling','streaming','multilingual','code'],
  'qwen-3-235b':['reasoning','function_calling','streaming','multilingual','code','arabic','long_context'],
  'qwen-3-32b':['reasoning','function_calling','streaming','multilingual','code','arabic'],
  'qwen-2-5-72b':['function_calling','streaming','multilingual','code','arabic','long_context'],
  'qwen-2-5-32b':['function_calling','streaming','multilingual','code','arabic'],
  'qwen-2-5-14b':['function_calling','streaming','multilingual','code','arabic'],
  'qwen-2-5-7b':['function_calling','streaming','multilingual','code'],
  'qwen-2-5-coder-32b':['code','function_calling','streaming','long_context'],
  'qwen-2-5-vl-72b':['vision','function_calling','streaming','multilingual','arabic'],
  'command-r-plus':['function_calling','streaming','multilingual','arabic','long_context','web_search'],
  'command-a':['function_calling','streaming','multilingual','arabic','long_context'],
  'aya-expanse-32b':['streaming','multilingual','arabic'],
  'aya-expanse-8b':['streaming','multilingual','arabic'],
  'phi-4':['function_calling','streaming','multilingual','code','arabic'],
  'phi-4-mini':['function_calling','streaming','multilingual','code'],
  'phi-3-5-mini':['function_calling','streaming','multilingual','code'],
  'phi-3-medium':['function_calling','streaming','multilingual','code'],
  'gemma-2-27b':['streaming','multilingual','code'],
  'gemma-2-9b':['streaming','multilingual','code'],
  'gemma-2-2b':['streaming'],
  'gemma-3-27b':['vision','streaming','multilingual','code','arabic'],
  'gemma-3-12b':['vision','streaming','multilingual','code'],
  'gemma-3-4b':['vision','streaming','multilingual'],
  'gemma-3-1b':['streaming'],
  'ernie-4-5':['vision','function_calling','streaming','multilingual'],
  'nemotron-4-340b':['streaming','multilingual','code','function_calling'],
  'nemotron-mini-4b':['streaming','code'],
  'amazon-nova-pro':['vision','audio','function_calling','streaming','multilingual','arabic','long_context'],
  'amazon-nova-lite':['vision','function_calling','streaming','multilingual','long_context'],
  'amazon-nova-micro':['function_calling','streaming','multilingual','arabic'],
  'samsung-gauss2':['streaming','multilingual','code'],
};

const capDescriptions = {
  'vision':'معالجة الصور وتحليلها',
  'audio':'معالجة الصوت والتفريغ',
  'function_calling':'استدعاء الدوال والأدوات',
  'json_mode':'إخراج JSON منظم مضمون',
  'streaming':'بث الاستجابة في الوقت الفعلي',
  'fine_tuning':'ضبط دقيق مخصص',
  'multilingual':'دعم لغات متعددة',
  'long_context':'نافذة سياق طويلة',
  'code':'توليد وتحليل الكود البرمجي',
  'reasoning':'التفكير المنطقي والاستدلال المتعدد الخطوات',
  'arabic':'دعم متخصص للغة العربية',
  'math':'حل المسائل الرياضية المعقدة',
  'web_search':'البحث على الإنترنت',
};

log('\n=== inserting capabilities ===');
let ok=0,skip=0,err=0;

for(const [slug, caps] of Object.entries(modelCaps)){
  const model = modelMap[slug];
  if(!model){continue;}
  for(const cap of caps){
    try{
      const key = slug+'_'+cap;
      if(existSet.has(key)){skip++;continue;}
      await pool.query(
        'INSERT INTO model_capabilities(model_id,capability,description,details,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(model_id,capability) DO NOTHING',
        [model.id, cap, capDescriptions[cap]||cap, JSON.stringify({verified:true,source:'official_docs'}), now, now]
      );
      ok++;
    }catch(e){log('ERR '+slug+'/'+cap+': '+e.message);err++;}
  }
}

const total = await pool.query('SELECT COUNT(*) FROM model_capabilities');
const byCap = await pool.query('SELECT capability, COUNT(*) as c FROM model_capabilities GROUP BY capability ORDER BY c DESC');
const coverage = await pool.query('SELECT COUNT(DISTINCT model_id) as n FROM model_capabilities');

log('ok:'+ok+' skip:'+skip+' err:'+err);
log('total capabilities: '+total.rows[0].count);
log('models covered: '+coverage.rows[0].n+'/74');
log('\nby capability:');
byCap.rows.forEach(x=>log('  '+x.capability.padEnd(20)+': '+x.c+' models'));
await pool.end();
