import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const log = (msg) => console.log('['+new Date().toISOString()+'] '+msg);

// خطوة 0: UNIQUE على slug
try {
  await pool.query('ALTER TABLE benchmark_definitions ADD CONSTRAINT benchmark_definitions_slug_unique UNIQUE (slug)');
  log('OK UNIQUE on benchmark_definitions.slug');
} catch(e) {
  if(e.message.includes('already exists')) log('SKIP constraint exists');
  else log('ERROR: '+e.message);
}

// خطوة 1: إضافة UNIQUE على model_benchmarks (model_id, benchmark_definition_id)
try {
  await pool.query('ALTER TABLE model_benchmarks ADD CONSTRAINT model_benchmarks_model_bench_unique UNIQUE (model_id, benchmark_definition_id)');
  log('OK UNIQUE on model_benchmarks(model_id,benchmark_definition_id)');
} catch(e) {
  if(e.message.includes('already exists')) log('SKIP constraint exists');
  else log('ERROR: '+e.message);
}

const benchmarks = [
  // reasoning
  {slug:'mmlu',name:{en:'MMLU',ar:'اختبار فهم اللغة متعدد المهام'},category:'reasoning',source:'https://arxiv.org/abs/2009.03300',meta:{max_score:100,unit:'accuracy_%',description:'57 academic subjects test'}},
  {slug:'hellaswag',name:{en:'HellaSwag',ar:'هيلاسواج'},category:'reasoning',source:'https://rowanzellers.com/hellaswag',meta:{max_score:100,unit:'accuracy_%',description:'Commonsense NLI benchmark'}},
  {slug:'arc-challenge',name:{en:'ARC Challenge',ar:'اختبار ARC الصعب'},category:'reasoning',source:'https://allenai.org/data/arc',meta:{max_score:100,unit:'accuracy_%',description:'Grade school science questions'}},
  {slug:'gpqa',name:{en:'GPQA Diamond',ar:'اختبار GPQA الماسي'},category:'reasoning',source:'https://arxiv.org/abs/2311.12022',meta:{max_score:100,unit:'accuracy_%',description:'PhD-level science questions'}},
  {slug:'bbh',name:{en:'BIG-Bench Hard',ar:'اختبار BIG-Bench الصعب'},category:'reasoning',source:'https://github.com/suzgunmirac/BIG-Bench-Hard',meta:{max_score:100,unit:'accuracy_%',description:'23 hard reasoning tasks'}},
  // coding
  {slug:'humaneval',name:{en:'HumanEval',ar:'هيومان إيفال'},category:'coding',source:'https://github.com/openai/human-eval',meta:{max_score:100,unit:'pass@1_%',description:'Python function completion'}},
  {slug:'mbpp',name:{en:'MBPP',ar:'اختبار برمجة بايثون'},category:'coding',source:'https://github.com/google-research/google-research/tree/master/mbpp',meta:{max_score:100,unit:'pass@1_%',description:'Mostly basic Python problems'}},
  {slug:'swebench',name:{en:'SWE-bench Verified',ar:'اختبار هندسة البرمجيات'},category:'coding',source:'https://www.swebench.com',meta:{max_score:100,unit:'resolved_%',description:'Real GitHub issues resolution'}},
  {slug:'livecodebench',name:{en:'LiveCodeBench',ar:'اختبار الكود الحي'},category:'coding',source:'https://livecodebench.github.io',meta:{max_score:100,unit:'accuracy_%',description:'Contamination-free coding eval'}},
  // math
  {slug:'math-500',name:{en:'MATH-500',ar:'اختبار الرياضيات 500'},category:'math',source:'https://github.com/hendrycks/math',meta:{max_score:100,unit:'accuracy_%',description:'500 competition math problems'}},
  {slug:'aime-2024',name:{en:'AIME 2024',ar:'مسابقة AIME 2024'},category:'math',source:'https://artofproblemsolving.com/wiki/index.php/AIME',meta:{max_score:30,unit:'problems_solved',description:'American math olympiad 2024'}},
  {slug:'gsm8k',name:{en:'GSM8K',ar:'مسائل الرياضيات المدرسية'},category:'math',source:'https://github.com/openai/grade-school-math',meta:{max_score:100,unit:'accuracy_%',description:'8500 grade school math problems'}},
  // language
  {slug:'mt-bench',name:{en:'MT-Bench',ar:'اختبار المحادثة متعدد الأدوار'},category:'language',source:'https://github.com/lm-sys/FastChat',meta:{max_score:10,unit:'score_1_10',description:'Multi-turn conversation quality'}},
  {slug:'arabic-mmlu',name:{en:'Arabic MMLU',ar:'اختبار MMLU العربي'},category:'language',source:'https://arxiv.org/abs/2402.12070',meta:{max_score:100,unit:'accuracy_%',description:'MMLU translated and adapted to Arabic'}},
  {slug:'flores-200',name:{en:'FLORES-200',ar:'اختبار الترجمة متعدد اللغات'},category:'language',source:'https://github.com/facebookresearch/flores',meta:{max_score:100,unit:'spBLEU',description:'200-language translation benchmark'}},
  // multimodal
  {slug:'mmmu',name:{en:'MMMU',ar:'اختبار الفهم متعدد الوسائط'},category:'multimodal',source:'https://mmmu-benchmark.github.io',meta:{max_score:100,unit:'accuracy_%',description:'Massive multi-discipline multimodal understanding'}},
  {slug:'mathvista',name:{en:'MathVista',ar:'اختبار الرياضيات البصرية'},category:'multimodal',source:'https://mathvista.github.io',meta:{max_score:100,unit:'accuracy_%',description:'Math reasoning with visual context'}},
  // safety
  {slug:'trustllm',name:{en:'TrustLLM',ar:'اختبار الثقة في النماذج'},category:'safety',source:'https://trustllmbenchmark.github.io',meta:{max_score:100,unit:'safety_score_%',description:'Comprehensive LLM trustworthiness evaluation'}},
  {slug:'salad-bench',name:{en:'SALAD-Bench',ar:'اختبار سلامة النماذج'},category:'safety',source:'https://github.com/OpenSafetyLab/SALAD-Bench',meta:{max_score:100,unit:'safety_score_%',description:'Safety alignment benchmark'}},
  // efficiency
  {slug:'ttft',name:{en:'Time to First Token',ar:'وقت أول رمز'},category:'efficiency',source:null,meta:{max_score:null,unit:'milliseconds',description:'Latency to first token generation'}},
  {slug:'throughput',name:{en:'Throughput Tokens/sec',ar:'معدل الإنتاجية'},category:'efficiency',source:null,meta:{max_score:null,unit:'tokens_per_second',description:'Output tokens per second'}},
  // agentic
  {slug:'tau-bench',name:{en:'TAU-bench',ar:'اختبار العوامل الذكية'},category:'agentic',source:'https://github.com/sierra-research/tau-bench',meta:{max_score:100,unit:'task_completion_%',description:'Tool-use and agentic task completion'}},
  {slug:'agentbench',name:{en:'AgentBench',ar:'اختبار الوكلاء'},category:'agentic',source:'https://github.com/THUDM/AgentBench',meta:{max_score:8,unit:'score_0_8',description:'LLM as agent benchmark'}},
  // long_context
  {slug:'needle-haystack',name:{en:'Needle in Haystack',ar:'اختبار الذاكرة الطويلة'},category:'long_context',source:'https://github.com/gkamradt/LLMTest_NeedleInAHaystack',meta:{max_score:100,unit:'accuracy_%',description:'Information retrieval in long contexts'}},
  {slug:'ruler',name:{en:'RULER',ar:'اختبار فهم السياق الطويل'},category:'long_context',source:'https://github.com/hsiehjackson/RULER',meta:{max_score:100,unit:'accuracy_%',description:'Long-context understanding benchmark'}},
  // instruction_following
  {slug:'ifeval',name:{en:'IFEval',ar:'اختبار اتباع التعليمات'},category:'instruction_following',source:'https://github.com/google-research/google-research/tree/master/instruction_following_eval',meta:{max_score:100,unit:'accuracy_%',description:'Instruction following evaluation'}},
];

log('\n=== inserting benchmark_definitions ===');
const existing = await pool.query('SELECT slug FROM benchmark_definitions');
const existSet = new Set(existing.rows.map(x=>x.slug));
let ok=0, skip=0, err=0;
const now = new Date().toISOString();

for(const b of benchmarks) {
  try {
    if(existSet.has(b.slug)) { skip++; continue; }
    await pool.query(
      `INSERT INTO benchmark_definitions(slug,name,category,source_url,metadata,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [b.slug, b.name, b.category, b.source||null, b.meta, now, now]
    );
    log('OK: '+b.slug);
    ok++;
  } catch(e) { log('ERROR '+b.slug+': '+e.message); err++; }
}

const total = await pool.query('SELECT COUNT(*) FROM benchmark_definitions');
log('\n=== VERIFY ===');
log('inserted:'+ok+' skip:'+skip+' err:'+err);
log('benchmark_definitions total: '+total.rows[0].count);

// عرض التوزيع per category
const cats = await pool.query('SELECT category, COUNT(*) as c FROM benchmark_definitions GROUP BY category ORDER BY category');
log('by category:');
cats.rows.forEach(x=>log('  '+x.category+': '+x.c));

await pool.end();
