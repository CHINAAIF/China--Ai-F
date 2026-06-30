import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true}});
const log = (msg) => console.log('['+new Date().toISOString()+'] '+msg);

// الخطوة 0: إضافة UNIQUE constraint على slug إذا لم توجد
try {
  await pool.query('ALTER TABLE models ADD CONSTRAINT models_slug_unique UNIQUE (slug)');
  log('OK added UNIQUE constraint on models.slug');
} catch(e) {
  if(e.message.includes('already exists')) log('SKIP constraint already exists');
  else log('ERROR constraint: '+e.message);
}

// قراءة vendors
const vendorMap = {};
try {
  const existing = await pool.query('SELECT id, slug FROM vendors');
  existing.rows.forEach(v => vendorMap[v.slug] = v.id);
  log('vendors loaded: '+Object.keys(vendorMap).join(', '));
} catch(e) { log('FATAL reading vendors: '+e.message); process.exit(1); }

// قراءة models الموجودة
const existingSlugs = new Set();
try {
  const em = await pool.query('SELECT slug FROM models');
  em.rows.forEach(x => existingSlugs.add(x.slug));
  log('existing model slugs: '+[...existingSlugs].join(', '));
} catch(e) { log('FATAL reading models: '+e.message); process.exit(1); }

const models = [
  // OpenAI
  {slug:'gpt-4o',name:{en:'GPT-4o',ar:'جي بي تي 4o'},vendor:'openai',type:'multimodal',context:128000,open:false,status:'active',langs:['en','ar','zh','fr','de','es']},
  {slug:'gpt-4o-mini',name:{en:'GPT-4o Mini',ar:'جي بي تي 4o ميني'},vendor:'openai',type:'multimodal',context:128000,open:false,status:'active',langs:['en','ar','zh']},
  {slug:'o3',name:{en:'o3',ar:'أو 3'},vendor:'openai',type:'reasoning',context:200000,open:false,status:'active',langs:['en','ar','zh']},
  {slug:'o4-mini',name:{en:'o4-mini',ar:'أو 4 ميني'},vendor:'openai',type:'reasoning',context:200000,open:false,status:'active',langs:['en','ar']},
  {slug:'gpt-4-5',name:{en:'GPT-4.5',ar:'جي بي تي 4.5'},vendor:'openai',type:'llm',context:128000,open:false,status:'active',langs:['en','ar','zh']},
  // Anthropic
  {slug:'claude-opus-4-6',name:{en:'Claude Opus 4.6',ar:'كلود أوبوس 4.6'},vendor:'anthropic',type:'llm',context:200000,open:false,status:'active',langs:['en','ar','zh','fr','de']},
  {slug:'claude-sonnet-4-6',name:{en:'Claude Sonnet 4.6',ar:'كلود سونيت 4.6'},vendor:'anthropic',type:'llm',context:200000,open:false,status:'active',langs:['en','ar','zh','fr','de']},
  {slug:'claude-haiku-4-5',name:{en:'Claude Haiku 4.5',ar:'كلود هايكو 4.5'},vendor:'anthropic',type:'llm',context:200000,open:false,status:'active',langs:['en','ar','zh']},
  // Google
  {slug:'gemini-2-5-pro',name:{en:'Gemini 2.5 Pro',ar:'جيميني 2.5 برو'},vendor:'google',type:'multimodal',context:1000000,open:false,status:'active',langs:['en','ar','zh','fr','de','es']},
  {slug:'gemini-2-5-flash',name:{en:'Gemini 2.5 Flash',ar:'جيميني 2.5 فلاش'},vendor:'google',type:'multimodal',context:1000000,open:false,status:'active',langs:['en','ar','zh']},
  {slug:'gemini-2-0-flash',name:{en:'Gemini 2.0 Flash',ar:'جيميني 2.0 فلاش'},vendor:'google',type:'multimodal',context:1000000,open:false,status:'active',langs:['en','ar','zh']},
  // Meta
  {slug:'llama-4-scout',name:{en:'Llama 4 Scout',ar:'لاما 4 سكاوت'},vendor:'meta',type:'multimodal',context:10000000,open:true,status:'active',langs:['en','ar','zh','fr','de','es']},
  {slug:'llama-4-maverick',name:{en:'Llama 4 Maverick',ar:'لاما 4 مافريك'},vendor:'meta',type:'multimodal',context:1000000,open:true,status:'active',langs:['en','ar','zh','fr']},
  {slug:'llama-3-3-70b',name:{en:'Llama 3.3 70B',ar:'لاما 3.3 70B'},vendor:'meta',type:'llm',context:128000,open:true,status:'active',langs:['en','ar','zh','fr','de','es']},
  // Mistral
  {slug:'mistral-large-3',name:{en:'Mistral Large 3',ar:'ميسترال لارج 3'},vendor:'mistral',type:'llm',context:128000,open:false,status:'active',langs:['en','fr','de','es','ar']},
  {slug:'mistral-small-3-1',name:{en:'Mistral Small 3.1',ar:'ميسترال سمول 3.1'},vendor:'mistral',type:'multimodal',context:128000,open:true,status:'active',langs:['en','fr','de','es']},
  {slug:'codestral',name:{en:'Codestral',ar:'كودسترال'},vendor:'mistral',type:'code',context:256000,open:false,status:'active',langs:['en']},
  // xAI
  {slug:'grok-3',name:{en:'Grok 3',ar:'غروك 3'},vendor:'xai',type:'llm',context:131072,open:false,status:'active',langs:['en','ar','zh']},
  {slug:'grok-3-mini',name:{en:'Grok 3 Mini',ar:'غروك 3 ميني'},vendor:'xai',type:'reasoning',context:131072,open:false,status:'active',langs:['en','ar']},
  // DeepSeek
  {slug:'deepseek-r2',name:{en:'DeepSeek R2',ar:'ديب سيك R2'},vendor:'deepseek',type:'reasoning',context:128000,open:false,status:'active',langs:['en','zh','ar']},
  {slug:'deepseek-v3',name:{en:'DeepSeek V3',ar:'ديب سيك V3'},vendor:'deepseek',type:'llm',context:128000,open:true,status:'active',langs:['en','zh','ar']},
  // Alibaba
  {slug:'qwen-3-235b',name:{en:'Qwen3 235B',ar:'كيوين 3 235B'},vendor:'alibaba',type:'reasoning',context:128000,open:true,status:'active',langs:['en','zh','ar']},
  {slug:'qwen-3-32b',name:{en:'Qwen3 32B',ar:'كيوين 3 32B'},vendor:'alibaba',type:'llm',context:128000,open:true,status:'active',langs:['en','zh','ar']},
  // Cohere
  {slug:'command-r-plus',name:{en:'Command R+',ar:'كوميند R+'},vendor:'cohere',type:'llm',context:128000,open:false,status:'active',langs:['en','ar','fr','de','es','zh']},
  {slug:'command-a',name:{en:'Command A',ar:'كوميند A'},vendor:'cohere',type:'llm',context:256000,open:false,status:'active',langs:['en','ar','fr','de']},
  // Microsoft
  {slug:'phi-4',name:{en:'Phi-4',ar:'فاي 4'},vendor:'microsoft',type:'llm',context:16384,open:true,status:'active',langs:['en','ar','zh','fr','de']},
  {slug:'phi-4-mini',name:{en:'Phi-4 Mini',ar:'فاي 4 ميني'},vendor:'microsoft',type:'llm',context:128000,open:true,status:'active',langs:['en','ar','zh']},
  // Baidu
  {slug:'ernie-4-5',name:{en:'ERNIE 4.5',ar:'ارني 4.5'},vendor:'baidu',type:'multimodal',context:128000,open:false,status:'active',langs:['zh','en']},
];

log('\n=== STEP 2: inserting models ===');
let ok=0, skip=0, err=0;
for(const m of models) {
  try {
    if(existingSlugs.has(m.slug)) { log('SKIP exists: '+m.slug); skip++; continue; }
    if(!vendorMap[m.vendor]) { log('ERROR no vendor: '+m.vendor); err++; continue; }
    await pool.query(
      `INSERT INTO models(slug,name,vendor_id,model_type,context_window,is_open_source,status,supported_languages)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.slug, m.name, vendorMap[m.vendor], m.type, m.context, m.open, m.status, m.langs]
    );
    log('OK: '+m.slug);
    ok++;
  } catch(e) { log('ERROR '+m.slug+': '+e.message); err++; }
}

// تحقق نهائي
const mc = await pool.query('SELECT COUNT(*) FROM models');
const vc = await pool.query('SELECT COUNT(*) FROM vendors');
const ms = await pool.query('SELECT slug, model_type, status FROM models ORDER BY created_at DESC LIMIT 10');
log('\n=== VERIFY ===');
log('inserted:'+ok+' skipped:'+skip+' errors:'+err);
log('vendors total: '+vc.rows[0].count);
log('models total: '+mc.rows[0].count);
log('latest models:');
ms.rows.forEach(x=>log('  '+x.slug+' | '+x.model_type+' | '+x.status));

await pool.end();
