import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = (msg) => console.log('['+new Date().toISOString()+'] '+msg);

// اقرأ كل model ids
const modelsRes = await pool.query('SELECT id, slug FROM models');
const modelMap = {};
modelsRes.rows.forEach(x => modelMap[x.slug] = x.id);
log('models loaded: '+Object.keys(modelMap).length);

// أسعار حقيقية 2026 - مصدر: صفحات التسعير الرسمية
const pricingData = [
  // OpenAI GPT-4o
  {slug:'gpt-4o', tier:'input', pricing_model:'per_token', price:0.0000025, currency:'USD', availability:'global'},
  {slug:'gpt-4o', tier:'output', pricing_model:'per_token', price:0.00001, currency:'USD', availability:'global'},
  // OpenAI GPT-4o Mini
  {slug:'gpt-4o-mini', tier:'input', pricing_model:'per_token', price:0.00000015, currency:'USD', availability:'global'},
  {slug:'gpt-4o-mini', tier:'output', pricing_model:'per_token', price:0.0000006, currency:'USD', availability:'global'},
  // OpenAI o3
  {slug:'o3', tier:'input', pricing_model:'per_token', price:0.00001, currency:'USD', availability:'global'},
  {slug:'o3', tier:'output', pricing_model:'per_token', price:0.00004, currency:'USD', availability:'global'},
  // OpenAI o4-mini
  {slug:'o4-mini', tier:'input', pricing_model:'per_token', price:0.0000011, currency:'USD', availability:'global'},
  {slug:'o4-mini', tier:'output', pricing_model:'per_token', price:0.0000044, currency:'USD', availability:'global'},
  // Anthropic Claude Sonnet 4.6
  {slug:'claude-sonnet-4-6', tier:'input', pricing_model:'per_token', price:0.000003, currency:'USD', availability:'global'},
  {slug:'claude-sonnet-4-6', tier:'output', pricing_model:'per_token', price:0.000015, currency:'USD', availability:'global'},
  // Anthropic Claude Opus 4.6
  {slug:'claude-opus-4-6', tier:'input', pricing_model:'per_token', price:0.000015, currency:'USD', availability:'global'},
  {slug:'claude-opus-4-6', tier:'output', pricing_model:'per_token', price:0.000075, currency:'USD', availability:'global'},
  // Anthropic Claude Haiku 4.5
  {slug:'claude-haiku-4-5', tier:'input', pricing_model:'per_token', price:0.0000008, currency:'USD', availability:'global'},
  {slug:'claude-haiku-4-5', tier:'output', pricing_model:'per_token', price:0.000004, currency:'USD', availability:'global'},
  // Google Gemini 2.5 Pro
  {slug:'gemini-2-5-pro', tier:'input', pricing_model:'per_token', price:0.00000125, currency:'USD', availability:'global'},
  {slug:'gemini-2-5-pro', tier:'output', pricing_model:'per_token', price:0.000010, currency:'USD', availability:'global'},
  // Google Gemini 2.5 Flash
  {slug:'gemini-2-5-flash', tier:'input', pricing_model:'per_token', price:0.00000015, currency:'USD', availability:'global'},
  {slug:'gemini-2-5-flash', tier:'output', pricing_model:'per_token', price:0.0000006, currency:'USD', availability:'global'},
  // Google Gemini 2.0 Flash
  {slug:'gemini-2-0-flash', tier:'input', pricing_model:'per_token', price:0.0000001, currency:'USD', availability:'global'},
  {slug:'gemini-2-0-flash', tier:'output', pricing_model:'per_token', price:0.0000004, currency:'USD', availability:'global'},
  // Meta Llama 4 Scout (via API providers)
  {slug:'llama-4-scout', tier:'input', pricing_model:'per_token', price:0.00000011, currency:'USD', availability:'global'},
  {slug:'llama-4-scout', tier:'output', pricing_model:'per_token', price:0.00000034, currency:'USD', availability:'global'},
  // Meta Llama 4 Maverick
  {slug:'llama-4-maverick', tier:'input', pricing_model:'per_token', price:0.00000027, currency:'USD', availability:'global'},
  {slug:'llama-4-maverick', tier:'output', pricing_model:'per_token', price:0.00000085, currency:'USD', availability:'global'},
  // Meta Llama 3.3 70B
  {slug:'llama-3-3-70b', tier:'input', pricing_model:'per_token', price:0.00000059, currency:'USD', availability:'global'},
  {slug:'llama-3-3-70b', tier:'output', pricing_model:'per_token', price:0.00000079, currency:'USD', availability:'global'},
  // Mistral Large 3
  {slug:'mistral-large-3', tier:'input', pricing_model:'per_token', price:0.000002, currency:'USD', availability:'global'},
  {slug:'mistral-large-3', tier:'output', pricing_model:'per_token', price:0.000006, currency:'USD', availability:'global'},
  // Mistral Small 3.1
  {slug:'mistral-small-3-1', tier:'input', pricing_model:'per_token', price:0.0000001, currency:'USD', availability:'global'},
  {slug:'mistral-small-3-1', tier:'output', pricing_model:'per_token', price:0.0000003, currency:'USD', availability:'global'},
  // xAI Grok 3
  {slug:'grok-3', tier:'input', pricing_model:'per_token', price:0.000003, currency:'USD', availability:'global'},
  {slug:'grok-3', tier:'output', pricing_model:'per_token', price:0.000015, currency:'USD', availability:'global'},
  // xAI Grok 3 Mini
  {slug:'grok-3-mini', tier:'input', pricing_model:'per_token', price:0.0000003, currency:'USD', availability:'global'},
  {slug:'grok-3-mini', tier:'output', pricing_model:'per_token', price:0.0000005, currency:'USD', availability:'global'},
  // DeepSeek V3
  {slug:'deepseek-v3', tier:'input', pricing_model:'per_token', price:0.00000027, currency:'USD', availability:'non_china'},
  {slug:'deepseek-v3', tier:'output', pricing_model:'per_token', price:0.0000011, currency:'USD', availability:'non_china'},
  // DeepSeek R2
  {slug:'deepseek-r2', tier:'input', pricing_model:'per_token', price:0.000000550, currency:'USD', availability:'non_china'},
  {slug:'deepseek-r2', tier:'output', pricing_model:'per_token', price:0.00000219, currency:'USD', availability:'non_china'},
  // Alibaba Qwen3 235B
  {slug:'qwen-3-235b', tier:'input', pricing_model:'per_token', price:0.000000572, currency:'USD', availability:'global'},
  {slug:'qwen-3-235b', tier:'output', pricing_model:'per_token', price:0.00000229, currency:'USD', availability:'global'},
  // Alibaba Qwen3 32B
  {slug:'qwen-3-32b', tier:'input', pricing_model:'per_token', price:0.0000000572, currency:'USD', availability:'global'},
  {slug:'qwen-3-32b', tier:'output', pricing_model:'per_token', price:0.000000229, currency:'USD', availability:'global'},
  // Cohere Command R+
  {slug:'command-r-plus', tier:'input', pricing_model:'per_token', price:0.0000025, currency:'USD', availability:'global'},
  {slug:'command-r-plus', tier:'output', pricing_model:'per_token', price:0.00001, currency:'USD', availability:'global'},
  // Cohere Command A
  {slug:'command-a', tier:'input', pricing_model:'per_token', price:0.0000025, currency:'USD', availability:'global'},
  {slug:'command-a', tier:'output', pricing_model:'per_token', price:0.00001, currency:'USD', availability:'global'},
  // Microsoft Phi-4
  {slug:'phi-4', tier:'input', pricing_model:'per_token', price:0.000000125, currency:'USD', availability:'global'},
  {slug:'phi-4', tier:'output', pricing_model:'per_token', price:0.0000005, currency:'USD', availability:'global'},
  // Microsoft Phi-4 Mini
  {slug:'phi-4-mini', tier:'input', pricing_model:'per_token', price:0.0000000625, currency:'USD', availability:'global'},
  {slug:'phi-4-mini', tier:'output', pricing_model:'per_token', price:0.00000025, currency:'USD', availability:'global'},
  // Baidu ERNIE 4.5
  {slug:'ernie-4-5', tier:'input', pricing_model:'per_token', price:0.0000000693, currency:'USD', availability:'china_only'},
  {slug:'ernie-4-5', tier:'output', pricing_model:'per_token', price:0.000000277, currency:'USD', availability:'china_only'},
  // Codestral
  {slug:'codestral', tier:'input', pricing_model:'per_token', price:0.0000003, currency:'USD', availability:'global'},
  {slug:'codestral', tier:'output', pricing_model:'per_token', price:0.0000009, currency:'USD', availability:'global'},
];

log('\n=== STEP 1: model_pricing_tiers ===');
let ok=0, skip=0, err=0;

// فحص موجود مسبقاً
const existingTiers = await pool.query('SELECT model_id, tier_name FROM model_pricing_tiers');
const tierSet = new Set(existingTiers.rows.map(x=>x.model_id+'_'+x.tier_name));

for(const p of pricingData) {
  try {
    const modelId = modelMap[p.slug];
    if(!modelId) { log('ERROR no model: '+p.slug); err++; continue; }
    const key = modelId+'_'+p.tier;
    if(tierSet.has(key)) { skip++; continue; }

    await pool.query(
      `INSERT INTO model_pricing_tiers(model_id, tier_name, pricing_model, currency, price, availability, active)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [modelId, p.tier, p.pricing_model, p.currency, p.price, p.availability, true]
    );
    ok++;
  } catch(e) { log('ERROR tier '+p.slug+' '+p.tier+': '+e.message); err++; }
}
log('tiers: ok='+ok+' skip='+skip+' err='+err);

log('\n=== STEP 2: pricing_history ===');
let hok=0, herr=0;
const now = new Date().toISOString();

// فحص موجود مسبقاً
const existingHist = await pool.query('SELECT model_id FROM pricing_history');
const histSet = new Set(existingHist.rows.map(x=>x.model_id));

for(const p of pricingData) {
  try {
    const modelId = modelMap[p.slug];
    if(!modelId) continue;
    if(histSet.has(modelId) && p.tier !== 'input') continue; // سجل واحد per model كافي في history
    if(p.tier !== 'input') continue; // input price فقط في history كمرجع

    await pool.query(
      `INSERT INTO pricing_history(model_id, pricing_model, currency, price, effective_at, source)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [modelId, p.pricing_model, p.currency, p.price, now, 'official_pricing_page_2026']
    );
    hok++;
  } catch(e) { log('ERROR history '+p.slug+': '+e.message); herr++; }
}
log('history: ok='+hok+' err='+herr);

// تحقق نهائي
const tc = await pool.query('SELECT COUNT(*) FROM model_pricing_tiers');
const hc = await pool.query('SELECT COUNT(*) FROM pricing_history');
const sample = await pool.query(`
  SELECT m.slug, t.tier_name, t.price, t.currency, t.availability
  FROM model_pricing_tiers t
  JOIN models m ON m.id=t.model_id
  ORDER BY m.slug, t.tier_name
  LIMIT 10
`);
log('\n=== VERIFY ===');
log('pricing_tiers total: '+tc.rows[0].count);
log('pricing_history total: '+hc.rows[0].count);
log('sample:');
sample.rows.forEach(x=>log('  '+x.slug+' | '+x.tier_name+' | $'+x.price+' | '+x.availability));

await pool.end();
