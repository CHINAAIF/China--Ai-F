
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = msg => console.log('['+new Date().toISOString()+'] '+msg);

// أكثر 25 لغة استخداماً في العالم — مرتبة بعدد المتحدثين
// المصدر: Ethnologue 2024 + Wikipedia
const TOP25_LANGUAGES = [
  'en',  // إنجليزية — 1.5 مليار
  'zh',  // صينية — 1.1 مليار
  'hi',  // هندية — 600 مليون
  'es',  // إسبانية — 560 مليون
  'ar',  // عربية — 420 مليون
  'bn',  // بنغالية — 270 مليون
  'fr',  // فرنسية — 280 مليون
  'pt',  // برتغالية — 260 مليون
  'ru',  // روسية — 250 مليون
  'ur',  // أردية — 230 مليون
  'id',  // إندونيسية — 200 مليون
  'de',  // ألمانية — 135 مليون
  'ja',  // يابانية — 125 million
  'ms',  // مالايو — 80 مليون
  'tr',  // تركية — 80 مليون
  'vi',  // فيتنامية — 85 مليون
  'ko',  // كورية — 82 مليون
  'fa',  // فارسية — 70 مليون
  'it',  // إيطالية — 68 مليون
  'th',  // تايلاندية — 60 مليون
  'pl',  // بولندية — 45 مليون
  'sw',  // سواحيلية — 100 مليون
  'nl',  // هولندية — 30 مليون
  'ro',  // رومانية — 26 مليون
  'el',  // يونانية — 13 مليون
];

// خريطة دعم اللغات الحقيقية لكل نموذج
// مبنية على الوثائق الرسمية والأبحاث المنشورة
const modelLanguages = {
  'gpt-4o':           ['en','zh','hi','es','ar','bn','fr','pt','ru','ur','id','de','ja','ms','tr','vi','ko','fa','it','th','pl','sw','nl','ro','el'],
  'gpt-4o-mini':      ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it','th','pl','nl'],
  'o3':               ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'o4-mini':          ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr'],
  'gpt-4-5':          ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'claude-opus-4-6':  ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id','nl','pl','fa','ur'],
  'claude-sonnet-4-6':['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id','nl','pl','fa','ur'],
  'claude-haiku-4-5': ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'gemini-2-5-pro':   ['en','zh','hi','es','ar','bn','fr','pt','ru','ur','id','de','ja','ms','tr','vi','ko','fa','it','th','pl','sw','nl','ro','el'],
  'gemini-2-5-flash': ['en','zh','hi','es','ar','bn','fr','pt','ru','id','de','ja','tr','vi','ko','it','th','pl','nl'],
  'gemini-2-0-flash': ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it','th'],
  'llama-4-scout':    ['en','zh','hi','es','ar','bn','fr','pt','ru','id','de','ja','ms','tr','vi','ko','fa','it','th','pl','nl','sw'],
  'llama-4-maverick': ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it','th','pl','nl'],
  'llama-3-3-70b':    ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'llama-3-1-405b':   ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id','nl','pl'],
  'llama-3-2-90b':    ['en','zh','hi','es','ar','fr','pt','de','ja','ko','it'],
  'llama-3-2-11b':    ['en','zh','es','fr','pt','de','it'],
  'llama-3-2-3b':     ['en','zh','es','fr','pt','de','it','hi'],
  'llama-3-2-1b':     ['en','zh','es','fr','de'],
  'mistral-large-3':  ['en','zh','es','ar','fr','pt','ru','de','ja','ko','it','tr','pl','nl','ro'],
  'mistral-small-3-1':['en','zh','es','fr','pt','ru','de','ja','it','tr','nl'],
  'mistral-7b-v03':   ['en','zh','es','fr','pt','de','it','nl'],
  'mixtral-8x7b':     ['en','zh','es','fr','pt','de','it','nl'],
  'mixtral-8x22b':    ['en','zh','es','ar','fr','pt','de','ja','it','tr','pl','nl'],
  'codestral':        ['en','zh','fr','de','pt','es','ru','it'],
  'grok-3':           ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'grok-3-mini':      ['en','zh','es','ar','fr','de','ja','ko'],
  'deepseek-v3':      ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it'],
  'deepseek-r2':      ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko'],
  'deepseek-r1':      ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko'],
  'deepseek-r1-distill-llama-70b':['en','zh','es','fr','de','ja','ko'],
  'deepseek-r1-distill-qwen-32b': ['en','zh','es','fr','de','ar'],
  'deepseek-coder-v2':['en','zh','fr','de','es','ru'],
  'deepseek-v2-5':    ['en','zh','es','ar','fr','de','ja','ko'],
  'qwen-3-235b':      ['en','zh','hi','es','ar','bn','fr','pt','ru','id','de','ja','ms','tr','vi','ko','fa','it','th','pl','sw','nl'],
  'qwen-3-32b':       ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it','th','pl'],
  'qwen-2-5-72b':     ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it','th','pl','nl'],
  'qwen-2-5-32b':     ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','vi','id'],
  'qwen-2-5-14b':     ['en','zh','es','ar','fr','pt','ru','de','ja','ko','it','tr'],
  'qwen-2-5-7b':      ['en','zh','es','ar','fr','pt','de','ja','ko','it'],
  'qwen-2-5-coder-32b':['en','zh','fr','de','es','ru','ja'],
  'qwen-2-5-vl-72b':  ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko'],
  'command-r-plus':   ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','nl'],
  'command-a':        ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr'],
  'aya-expanse-32b':  ['en','zh','hi','es','ar','bn','fr','pt','ru','ur','id','de','ja','ms','tr','vi','ko','fa','it','th','pl','sw','nl'],
  'aya-expanse-8b':   ['en','zh','hi','es','ar','fr','pt','ru','id','de','ja','tr','vi','ko','it'],
  'phi-4':            ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','nl','pl'],
  'phi-4-mini':       ['en','zh','hi','es','ar','fr','pt','de','ja','ko','it','tr'],
  'phi-3-5-mini':     ['en','zh','hi','es','ar','fr','pt','de','ja','it','tr'],
  'phi-3-medium':     ['en','zh','hi','es','ar','fr','pt','de','ja','it'],
  'gemma-2-27b':      ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','id','vi'],
  'gemma-2-9b':       ['en','zh','es','fr','pt','de','ja','ko','it','tr','id'],
  'gemma-2-2b':       ['en','zh','es','fr','de'],
  'gemma-3-27b':      ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ko','it','tr','id','vi','nl','pl'],
  'gemma-3-12b':      ['en','zh','hi','es','ar','fr','pt','de','ja','ko','it','tr','id'],
  'gemma-3-4b':       ['en','zh','es','fr','pt','de','ja','it'],
  'gemma-3-1b':       ['en','zh','es','fr'],
  'ernie-4-5':        ['zh','en','ja','ko','fr','de','es','pt','ru','ar'],
  'nemotron-4-340b':  ['en','zh','fr','de','es','pt','ru','ja','it'],
  'nemotron-mini-4b': ['en','zh','de','fr'],
  'amazon-nova-pro':  ['en','zh','hi','es','ar','fr','pt','ru','de','ja','ms','tr','vi','ko','it','id'],
  'amazon-nova-lite': ['en','zh','hi','es','ar','fr','pt','de','ja','ko','it','tr','id'],
  'amazon-nova-micro':['en','zh','hi','es','ar','fr','pt','de','ja','ko'],
  'samsung-gauss2':   ['en','ko','zh','ja','de','fr','es'],
};

log('=== updating supported_languages ===');
let ok=0,err=0;
for(const [slug,langs] of Object.entries(modelLanguages)){
  try{
    const r = await pool.query(
      'UPDATE models SET supported_languages=$1, updated_at=now() WHERE slug=$2 RETURNING id',
      [langs, slug]
    );
    if(r.rowCount===0) log('WARN not found: '+slug);
    else ok++;
  }catch(e){log('ERR '+slug+': '+e.message);err++;}
}

// تحقق
const stats = await pool.query(`
  SELECT 
    COUNT(*) as total,
    COUNT(supported_languages) as has_langs,
    AVG(array_length(supported_languages,1)) as avg_langs
  FROM models
`);
const topLangs = await pool.query(`
  SELECT lang, COUNT(*) as models
  FROM models, unnest(supported_languages) as lang
  GROUP BY lang
  ORDER BY models DESC
  LIMIT 25
`);

log('updated: ok='+ok+' err='+err);
log('total models: '+stats.rows[0].total);
log('with languages: '+stats.rows[0].has_langs);
log('avg languages per model: '+parseFloat(stats.rows[0].avg_langs).toFixed(1));
log('\nTop 25 languages coverage:');
topLangs.rows.forEach(x=>log('  '+x.lang.padEnd(5)+': '+x.models+' models'));
await pool.end();
