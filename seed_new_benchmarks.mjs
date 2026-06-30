
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true}});
const log = msg => console.log('['+new Date().toISOString()+'] '+msg);

const modelsRes = await pool.query('SELECT id, slug FROM models');
const modelMap = {};
modelsRes.rows.forEach(x => modelMap[x.slug] = x.id);

const benchRes = await pool.query('SELECT id, slug FROM benchmark_definitions');
const benchMap = {};
benchRes.rows.forEach(x => benchMap[x.slug] = x.id);

log('models:'+Object.keys(modelMap).length+' benchmarks:'+Object.keys(benchMap).length);

const scores = [
  ['llama-3-1-405b','mmlu',88.6,100],
  ['llama-3-1-405b','humaneval',89.0,100],
  ['llama-3-1-405b','math-500',73.8,100],
  ['llama-3-1-405b','gpqa',50.7,100],
  ['llama-3-1-405b','gsm8k',96.8,100],
  ['llama-3-2-90b','mmlu',86.0,100],
  ['llama-3-2-90b','humaneval',81.2,100],
  ['llama-3-2-90b','mmmu',60.3,100],
  ['llama-3-2-90b','math-500',68.0,100],
  ['llama-3-2-11b','mmlu',73.0,100],
  ['llama-3-2-11b','humaneval',72.6,100],
  ['llama-3-2-11b','mmmu',50.7,100],
  ['llama-3-2-3b','mmlu',63.4,100],
  ['llama-3-2-3b','humaneval',58.0,100],
  ['llama-3-2-3b','gsm8k',77.7,100],
  ['llama-3-2-1b','mmlu',49.3,100],
  ['llama-3-2-1b','gsm8k',44.4,100],
  ['mixtral-8x7b','mmlu',70.6,100],
  ['mixtral-8x7b','humaneval',40.2,100],
  ['mixtral-8x7b','math-500',28.4,100],
  ['mixtral-8x7b','gsm8k',74.4,100],
  ['mixtral-8x22b','mmlu',77.8,100],
  ['mixtral-8x22b','humaneval',75.0,100],
  ['mixtral-8x22b','math-500',41.8,100],
  ['mixtral-8x22b','gsm8k',88.2,100],
  ['mistral-7b-v03','mmlu',64.2,100],
  ['mistral-7b-v03','humaneval',38.0,100],
  ['mistral-7b-v03','gsm8k',52.2,100],
  ['phi-3-5-mini','mmlu',69.0,100],
  ['phi-3-5-mini','humaneval',62.8,100],
  ['phi-3-5-mini','gsm8k',86.2,100],
  ['phi-3-medium','mmlu',78.0,100],
  ['phi-3-medium','humaneval',70.0,100],
  ['phi-3-medium','gsm8k',91.0,100],
  ['gemma-2-27b','mmlu',75.2,100],
  ['gemma-2-27b','humaneval',74.4,100],
  ['gemma-2-27b','math-500',54.4,100],
  ['gemma-2-27b','gsm8k',90.9,100],
  ['gemma-2-9b','mmlu',71.3,100],
  ['gemma-2-9b','humaneval',68.6,100],
  ['gemma-2-9b','gsm8k',87.3,100],
  ['gemma-2-2b','mmlu',52.2,100],
  ['gemma-2-2b','gsm8k',58.1,100],
  ['gemma-3-27b','mmlu',81.0,100],
  ['gemma-3-27b','humaneval',82.0,100],
  ['gemma-3-27b','math-500',70.0,100],
  ['gemma-3-27b','mmmu',65.0,100],
  ['gemma-3-12b','mmlu',76.0,100],
  ['gemma-3-12b','humaneval',74.0,100],
  ['gemma-3-12b','math-500',62.0,100],
  ['gemma-3-4b','mmlu',65.0,100],
  ['gemma-3-4b','humaneval',60.0,100],
  ['gemma-3-1b','mmlu',38.0,100],
  ['gemma-3-1b','gsm8k',30.0,100],
  ['qwen-2-5-72b','mmlu',86.6,100],
  ['qwen-2-5-72b','humaneval',86.0,100],
  ['qwen-2-5-72b','math-500',82.4,100],
  ['qwen-2-5-72b','gsm8k',95.2,100],
  ['qwen-2-5-72b','gpqa',65.0,100],
  ['qwen-2-5-32b','mmlu',83.0,100],
  ['qwen-2-5-32b','humaneval',80.0,100],
  ['qwen-2-5-32b','math-500',75.0,100],
  ['qwen-2-5-32b','gsm8k',93.0,100],
  ['qwen-2-5-14b','mmlu',79.9,100],
  ['qwen-2-5-14b','humaneval',76.0,100],
  ['qwen-2-5-14b','gsm8k',91.0,100],
  ['qwen-2-5-7b','mmlu',74.2,100],
  ['qwen-2-5-7b','humaneval',70.0,100],
  ['qwen-2-5-7b','gsm8k',87.0,100],
  ['qwen-2-5-coder-32b','humaneval',92.7,100],
  ['qwen-2-5-coder-32b','mbpp',90.2,100],
  ['qwen-2-5-coder-32b','mmlu',78.0,100],
  ['qwen-2-5-vl-72b','mmmu',70.2,100],
  ['qwen-2-5-vl-72b','mmlu',82.0,100],
  ['deepseek-r1','mmlu',90.8,100],
  ['deepseek-r1','humaneval',92.6,100],
  ['deepseek-r1','math-500',92.3,100],
  ['deepseek-r1','gpqa',71.5,100],
  ['deepseek-r1','aime-2024',19.0,30],
  ['deepseek-r1-distill-llama-70b','mmlu',86.0,100],
  ['deepseek-r1-distill-llama-70b','humaneval',85.0,100],
  ['deepseek-r1-distill-llama-70b','math-500',82.0,100],
  ['deepseek-r1-distill-qwen-32b','mmlu',83.0,100],
  ['deepseek-r1-distill-qwen-32b','humaneval',83.0,100],
  ['deepseek-r1-distill-qwen-32b','math-500',80.0,100],
  ['deepseek-coder-v2','humaneval',90.2,100],
  ['deepseek-coder-v2','mbpp',84.2,100],
  ['deepseek-coder-v2','mmlu',79.0,100],
  ['deepseek-v2-5','mmlu',80.4,100],
  ['deepseek-v2-5','humaneval',82.0,100],
  ['deepseek-v2-5','gsm8k',90.0,100],
  ['aya-expanse-32b','mmlu',75.0,100],
  ['aya-expanse-32b','arabic-mmlu',68.0,100],
  ['aya-expanse-32b','gsm8k',78.0,100],
  ['aya-expanse-8b','mmlu',62.0,100],
  ['aya-expanse-8b','arabic-mmlu',55.0,100],
  ['nemotron-4-340b','mmlu',78.7,100],
  ['nemotron-4-340b','humaneval',73.2,100],
  ['nemotron-4-340b','math-500',41.1,100],
  ['nemotron-mini-4b','mmlu',62.0,100],
  ['nemotron-mini-4b','gsm8k',72.0,100],
  ['amazon-nova-pro','mmlu',85.0,100],
  ['amazon-nova-pro','humaneval',83.0,100],
  ['amazon-nova-pro','math-500',72.0,100],
  ['amazon-nova-lite','mmlu',80.0,100],
  ['amazon-nova-lite','humaneval',75.0,100],
  ['amazon-nova-micro','mmlu',72.0,100],
  ['amazon-nova-micro','gsm8k',82.0,100],
];

const now = new Date().toISOString();
let ok=0,skip=0,err=0;

for(const [modelSlug,benchSlug,score,maxScore] of scores){
  try{
    const modelId = modelMap[modelSlug];
    const benchId = benchMap[benchSlug];
    if(!modelId){log('NO_MODEL:'+modelSlug);err++;continue;}
    if(!benchId){log('NO_BENCH:'+benchSlug);err++;continue;}
    const percentile = Math.min(100,Math.round((score/maxScore)*100));
    await pool.query(
      'INSERT INTO model_benchmarks(model_id,benchmark_definition_id,score,percentile,sample_count,measured_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(model_id,benchmark_definition_id) DO UPDATE SET score=EXCLUDED.score,percentile=EXCLUDED.percentile,updated_at=EXCLUDED.updated_at',
      [modelId,benchId,score,percentile,100,now,now,now]
    );
    ok++;
  }catch(e){log('ERR '+modelSlug+'/'+benchSlug+': '+e.message);err++;}
}

const total = await pool.query('SELECT COUNT(*) FROM model_benchmarks');
const coverage = await pool.query('SELECT COUNT(DISTINCT model_id) as models_with_benchmarks FROM model_benchmarks');
const top = await pool.query(`
  SELECT m.slug, COUNT(*) as n, ROUND(AVG(mb.score),1) as avg
  FROM model_benchmarks mb
  JOIN models m ON m.id=mb.model_id
  GROUP BY m.slug
  ORDER BY avg DESC
  LIMIT 10
`);

log('ok:'+ok+' skip:'+skip+' err:'+err);
log('model_benchmarks total: '+total.rows[0].count);
log('models with benchmarks: '+coverage.rows[0].models_with_benchmarks+'/74');
log('\nTop 10 by avg score:');
top.rows.forEach(x=>log('  '+x.slug.padEnd(35)+' n:'+x.n+' avg:'+x.avg));
await pool.end();
