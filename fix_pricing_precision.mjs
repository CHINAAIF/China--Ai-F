import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true}});
const log = (msg) => console.log('['+new Date().toISOString()+'] '+msg);

// الخطوة 1: تغيير precision للعمودين
try {
  await pool.query('ALTER TABLE model_pricing_tiers ALTER COLUMN price TYPE numeric(20,10)');
  log('OK model_pricing_tiers.price -> numeric(20,10)');
} catch(e) { log('ERROR alter tiers: '+e.message); }

try {
  await pool.query('ALTER TABLE pricing_history ALTER COLUMN price TYPE numeric(20,10)');
  log('OK pricing_history.price -> numeric(20,10)');
} catch(e) { log('ERROR alter history: '+e.message); }

// الخطوة 2: تحديث الأسعار الصحيحة — per token (القيم الأصلية الصحيحة)
const prices = [
  // slug, tier, price_per_token
  ['gpt-4o','input',0.0000025],
  ['gpt-4o','output',0.00001],
  ['gpt-4o-mini','input',0.00000015],
  ['gpt-4o-mini','output',0.0000006],
  ['o3','input',0.00001],
  ['o3','output',0.00004],
  ['o4-mini','input',0.0000011],
  ['o4-mini','output',0.0000044],
  ['gpt-4-5','input',0.0000075],
  ['gpt-4-5','output',0.00003],
  ['claude-opus-4-6','input',0.000015],
  ['claude-opus-4-6','output',0.000075],
  ['claude-sonnet-4-6','input',0.000003],
  ['claude-sonnet-4-6','output',0.000015],
  ['claude-haiku-4-5','input',0.0000008],
  ['claude-haiku-4-5','output',0.000004],
  ['gemini-2-5-pro','input',0.00000125],
  ['gemini-2-5-pro','output',0.000010],
  ['gemini-2-5-flash','input',0.00000015],
  ['gemini-2-5-flash','output',0.0000006],
  ['gemini-2-0-flash','input',0.0000001],
  ['gemini-2-0-flash','output',0.0000004],
  ['llama-4-scout','input',0.00000011],
  ['llama-4-scout','output',0.00000034],
  ['llama-4-maverick','input',0.00000027],
  ['llama-4-maverick','output',0.00000085],
  ['llama-3-3-70b','input',0.00000059],
  ['llama-3-3-70b','output',0.00000079],
  ['mistral-large-3','input',0.000002],
  ['mistral-large-3','output',0.000006],
  ['mistral-small-3-1','input',0.0000001],
  ['mistral-small-3-1','output',0.0000003],
  ['codestral','input',0.0000003],
  ['codestral','output',0.0000009],
  ['grok-3','input',0.000003],
  ['grok-3','output',0.000015],
  ['grok-3-mini','input',0.0000003],
  ['grok-3-mini','output',0.0000005],
  ['deepseek-v3','input',0.00000027],
  ['deepseek-v3','output',0.0000011],
  ['deepseek-r2','input',0.00000055],
  ['deepseek-r2','output',0.00000219],
  ['qwen-3-235b','input',0.000000572],
  ['qwen-3-235b','output',0.00000229],
  ['qwen-3-32b','input',0.0000000572],
  ['qwen-3-32b','output',0.000000229],
  ['command-r-plus','input',0.0000025],
  ['command-r-plus','output',0.00001],
  ['command-a','input',0.0000025],
  ['command-a','output',0.00001],
  ['phi-4','input',0.000000125],
  ['phi-4','output',0.0000005],
  ['phi-4-mini','input',0.0000000625],
  ['phi-4-mini','output',0.00000025],
  ['ernie-4-5','input',0.0000000693],
  ['ernie-4-5','output',0.000000277],
];

// اقرأ model ids
const modelsRes = await pool.query('SELECT id, slug FROM models');
const modelMap = {};
modelsRes.rows.forEach(x => modelMap[x.slug] = x.id);

log('\n=== STEP 2: updating prices ===');
let ok=0, err=0;
for(const [slug, tier, price] of prices) {
  try {
    const modelId = modelMap[slug];
    if(!modelId) { log('ERROR no model: '+slug); err++; continue; }
    const r = await pool.query(
      'UPDATE model_pricing_tiers SET price=$1 WHERE model_id=$2 AND tier_name=$3',
      [price, modelId, tier]
    );
    if(r.rowCount===0) log('WARN no row updated: '+slug+' '+tier);
    else ok++;
  } catch(e) { log('ERROR '+slug+' '+tier+': '+e.message); err++; }
}
log('updated: ok='+ok+' err='+err);

// تحديث pricing_history أيضاً
log('\n=== STEP 3: updating pricing_history ===');
let hok=0;
for(const [slug, tier, price] of prices.filter(x=>x[1]==='input')) {
  try {
    const modelId = modelMap[slug];
    if(!modelId) continue;
    await pool.query('UPDATE pricing_history SET price=$1 WHERE model_id=$2', [price, modelId]);
    hok++;
  } catch(e) { log('ERROR history '+slug+': '+e.message); }
}
log('history updated: '+hok);

// تحقق نهائي
const sample = await pool.query(`
  SELECT m.slug, t.tier_name, t.price::text
  FROM model_pricing_tiers t
  JOIN models m ON m.id=t.model_id
  WHERE m.slug IN ('gpt-4o','claude-sonnet-4-6','gemini-2-5-pro','deepseek-v3','llama-4-scout','qwen-3-235b')
  ORDER BY m.slug, t.tier_name
`);
log('\n=== VERIFY — prices per token USD ===');
sample.rows.forEach(x=>log('  '+x.slug.padEnd(20)+' | '+x.tier_name.padEnd(8)+' | $'+x.price));

await pool.end();
