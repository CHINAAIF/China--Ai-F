import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';
import { pingHeartbeat } from '../utils/heartbeat.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const BENCHMARK_QUESTIONS = {
  'chinese_ai_models': 'ما هي أبرز نماذج الذكاء الاصطناعي الصينية في 2025 ومزاياها التقنية؟ أجب بـ JSON: {models:array,key_differentiators:string,confidence:number}',
  'ai_pricing':        'ما تكلفة استخدام GPT-4o مقارنة بـClaude Sonnet لمليون token؟ أجب بـ JSON: {gpt4o_price:string,claude_price:string,analysis:string,confidence:number}',
  'ai_regulations':    'ما أبرز لوائح تنظيم الذكاء الاصطناعي في الصين حتى 2025؟ أجب بـ JSON: {regulations:array,impact:string,confidence:number}',
  'llm_benchmarks':    'ما أفضل نموذج لغوي في مهام الاستدلال المنطقي وفق آخر المعايير؟ أجب بـ JSON: {top_model:string,benchmark_name:string,score:number,confidence:number}',
  'market_intelligence':'ما حجم سوق الذكاء الاصطناعي العالمي وأسرع القطاعات نمواً؟ أجب بـ JSON: {market_size:string,growth_rate:string,top_sectors:array,confidence:number}'
};

const FREE_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'allam-2-7b',
  'openai/gpt-oss-120b'
];

class ModelBenchmarkingEngine {
  constructor() {
    this.name = 'model_benchmarking_engine';
    this.layer = 'analysis';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status='db_error'; return false; }
  }

  async fetchModelAnswer(modelName, question) {
    const start = Date.now();
    try {
      const res = await groq.chat.completions.create({
        model: modelName,
        messages: [
          { role:'system', content:'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown.' },
          { role:'user', content: question }
        ],
        temperature: 0.1,
        max_tokens: 500
      });
      const latency = Date.now() - start;
      const raw = res.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json|```/g,'').trim();
      let parsed;
      try { parsed = JSON.parse(clean); }
      catch(_) { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
      if (!parsed) return { success:false, latency, reason:'no_json' };
      return { success:true, latency, parsed };
    } catch(e) {
      return { success:false, latency: Date.now()-start, reason: e.message };
    }
  }

  normalizeConfidence(raw) {
    const n = Number(raw);
    if (raw === undefined || raw === null || isNaN(n)) return 70;
    const scaled = n <= 1 ? n * 100 : n;
    return Math.min(100, Math.max(0, Math.round(scaled)));
  }

  contentQualityScore(parsed) {
    const fields = Object.entries(parsed).filter(([k]) => k !== 'confidence');
    if (!fields.length) return 0;
    let score = 0;
    for (const [, v] of fields) {
      if (Array.isArray(v)) score += Math.min(20, v.length * 5);
      else if (typeof v === 'string') score += Math.min(20, Math.floor(v.length / 10));
      else if (typeof v === 'number') score += 10;
      else score += 5;
    }
    return Math.min(100, score);
  }

  consensusScore(parsedAnswer, allParsed) {
    const others = allParsed.filter(a => a !== parsedAnswer);
    if (!others.length) return 50;
    const wordsOf = (obj) => new Set((JSON.stringify(obj).toLowerCase().match(/[a-z\u0600-\u06FF0-9]{3,}/g)) || []);
    const target = wordsOf(parsedAnswer);
    let total = 0;
    for (const other of others) {
      const ow = wordsOf(other);
      const inter = [...target].filter(w => ow.has(w)).length;
      const union = new Set([...target, ...ow]).size || 1;
      total += inter / union;
    }
    return Math.round((total / others.length) * 100);
  }

  async upsertAccuracy(modelKey, domain, accuracy, latency, confidence) {
    try {
      await pool.query(`
        INSERT INTO model_accuracy_registry (model_key,domain,accuracy_score,sample_count,avg_latency_ms,avg_confidence,last_benchmarked)
        VALUES ($1,$2,$3,1,$4,$5,now())
        ON CONFLICT (model_key,domain) DO UPDATE SET
          accuracy_score = ((model_accuracy_registry.accuracy_score * model_accuracy_registry.sample_count) + EXCLUDED.accuracy_score) / (model_accuracy_registry.sample_count + 1),
          avg_latency_ms = ((model_accuracy_registry.avg_latency_ms * model_accuracy_registry.sample_count) + EXCLUDED.avg_latency_ms) / (model_accuracy_registry.sample_count + 1),
          avg_confidence = ((model_accuracy_registry.avg_confidence * model_accuracy_registry.sample_count) + EXCLUDED.avg_confidence) / (model_accuracy_registry.sample_count + 1),
          sample_count = model_accuracy_registry.sample_count + 1,
          last_benchmarked = now()`,
        [modelKey, domain, Math.round(accuracy), Math.round(latency), Math.round(confidence)]
      );
    } catch(e) { console.warn(`⚠️ upsert_accuracy: ${e.message}`); }
  }

  async updateModelRegistry(modelKey, avgLatency, successRate) {
    try {
      await pool.query(`
        UPDATE model_registry_sovereign SET
          avg_latency_ms=$2, success_rate=$3, last_used_at=now()
        WHERE model_key=$1`,
        [modelKey, Math.round(avgLatency), Math.min(100,Math.max(0,Math.round(successRate)))]
      );
    } catch(e) { console.warn(`⚠️ update_registry: ${e.message}`); }
  }

  async run(input = {}) {
    try {
      await pingHeartbeat(this.name, 'active', { layer: this.layer });
      const results = {};
      let totalTests = 0, totalSuccess = 0;

      for (const [domain, question] of Object.entries(BENCHMARK_QUESTIONS)) {
        results[domain] = {};
        const domainAnswers = [];
        const rawResults = {};

        for (const model of FREE_MODELS) {
          totalTests++;
          const r = await this.fetchModelAnswer(model, question);
          rawResults[model] = r;
          if (r.success) domainAnswers.push(r.parsed);
          await new Promise(res => setTimeout(res, 200));
        }

        for (const model of FREE_MODELS) {
          const r = rawResults[model];
          if (!r.success) { results[domain][model] = { accuracy:0, error:r.reason }; continue; }
          totalSuccess++;
          const normConf = this.normalizeConfidence(r.parsed.confidence);
          const quality  = this.contentQualityScore(r.parsed);
          const consensus = this.consensusScore(r.parsed, domainAnswers);
          const accuracy = Math.round(0.45*normConf + 0.30*quality + 0.25*consensus);
          await this.upsertAccuracy(model, domain, accuracy, r.latency, normConf);
          results[domain][model] = { accuracy, latency: r.latency, confidence: normConf, quality, consensus };
        }
      }

      for (const model of FREE_MODELS) {
        const scores = Object.values(results).map(d=>d[model]).filter(r=>r && r.accuracy>0);
        if (scores.length) {
          const avgLat = scores.reduce((a,b)=>a+b.latency,0)/scores.length;
          const successRate = (scores.length/Object.keys(BENCHMARK_QUESTIONS).length)*100;
          await this.updateModelRegistry(model, avgLat, successRate);
        }
      }

      const verify = await pool.query(`SELECT model_key,domain,accuracy_score,avg_latency_ms,avg_confidence FROM model_accuracy_registry ORDER BY accuracy_score DESC LIMIT 10`);
      try {
        await pool.query(`INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,'benchmark',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify({domains:Object.keys(BENCHMARK_QUESTIONS).length, models:FREE_MODELS.length}),
           JSON.stringify({totalTests,totalSuccess,top_results:verify.rows}), Math.round((totalSuccess/totalTests)*100)]);
      } catch(e) { console.warn(`⚠️ log_fail: ${e.message}`); }

      console.log(`✅ benchmarking: tests=${totalTests} success=${totalSuccess} accuracy_records=${verify.rows.length}`);
      verify.rows.forEach(r=>console.log(`  ${r.model_key}@${r.domain}: accuracy=${r.accuracy_score}% conf=${r.avg_confidence} latency=${r.avg_latency_ms}ms`));

      return { success:true, totalTests, totalSuccess, accuracy_records:verify.rows.length, top_results:verify.rows };
    } catch(e) {
      console.error(`❌ model_benchmarking_engine: ${e.message}`);
      return { success:false, error:e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({test:true});
    return { agent:this.name, status:r.success?'ok':'error', ...r };
  }
}

export const modelBenchmarkingEngine = new ModelBenchmarkingEngine();
export default modelBenchmarkingEngine;
