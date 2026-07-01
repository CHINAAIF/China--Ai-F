import { logExecution, safeStep } from '../utils/executor.js';
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_INTELLIGENCE, ssl:{ rejectUnauthorized: true } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class BenchmarkRunnerAgent {
  constructor() {
    this.name = 'benchmark_runner_agent';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    try {
      const benchmarks = await pool.query(`
        SELECT bd.slug, bd.name->>'en' as name_en, bd.category,
               COUNT(mb.id) as model_count,
               AVG(mb.score) as avg_score,
               MAX(mb.score) as max_score
        FROM benchmark_definitions bd
        LEFT JOIN model_benchmarks mb ON mb.benchmark_definition_id = bd.id
        GROUP BY bd.id, bd.slug, bd.name, bd.category
        ORDER BY bd.category, bd.slug
      `);

      const topModels = await pool.query(`
        SELECT m.slug, m.name->>'en' as name_en, v.slug as vendor,
               COUNT(mb.id) as benchmark_count,
               AVG(mb.score) as avg_score,
               AVG(mb.percentile) as avg_percentile
        FROM models m
        JOIN vendors v ON m.vendor_id = v.id
        JOIN model_benchmarks mb ON mb.model_id = m.id
        WHERE m.status = 'active'
        GROUP BY m.id, m.slug, m.name, v.slug
        ORDER BY avg_percentile DESC
        LIMIT 10
      `);

      const prompt = `أنت محلل معايير أداء نماذج الذكاء الاصطناعي.

المعايير المتاحة (${benchmarks.rows.length} معيار):
${benchmarks.rows.map(b => b.slug + ' | ' + b.category + ' | نماذج: ' + b.model_count + ' | متوسط: ' + (parseFloat(b.avg_score)||0).toFixed(1)).join('\n')}

أفضل النماذج حالياً:
${topModels.rows.map(m => m.slug + ' | ' + m.vendor + ' | متوسط percentile: ' + (parseFloat(m.avg_percentile)||0).toFixed(1)).join('\n')}

مهمتك: تحليل نتائج المعايير وتحديد:
1. أي نماذج تحتاج تحديث نتائجها
2. أي معايير جديدة يجب إضافتها
3. التغييرات في ترتيب النماذج مؤخراً

أجب بـJSON فقط بدون أي نص خارجه:
{
  "signals": [
    {
      "model_slug": "gpt-4o",
      "signal_type": "performance_update",
      "title": "عنوان",
      "content": "وصف تفصيلي",
      "confidence": 80,
      "impact_level": "medium"
    }
  ],
  "benchmark_summary": "ملخص حالة المعايير",
  "models_needing_update": ["slug1", "slug2"],
  "confidence": 75
}`;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1500,
      });

      let result;
      try {
        const text = completion.choices[0].message.content;
        const clean = text.replace(/```json|```/g, '').trim();
        result = JSON.parse(clean);
      } catch(e) { throw new Error('JSON parse failed: ' + e.message); }

      let inserted = 0;
      for (const signal of (result.signals || [])) {
        try {
          await pool.query(
            'INSERT INTO intelligence_raw (agent_name, content_type, raw_content, title, confidence, filter_status, signals) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [this.name, signal.signal_type, signal.content, signal.title,
             Math.min(100, Math.max(0, signal.confidence || 75)), 'pending',
             JSON.stringify({ model: signal.model_slug, impact: signal.impact_level })]
          );
          inserted++;
        } catch(e) { console.warn('insert failed:', e.message); }
      }

      await pool.query(
        'INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [this.name, 'run', '{}',
         JSON.stringify({ inserted, benchmark_summary: result.benchmark_summary, models_needing_update: result.models_needing_update }),
         Math.min(100, Math.max(0, Math.round(result.confidence || 75))), 'completed']
      );

      console.log('benchmark_runner_agent: inserted', inserted, 'signals');
      return { success: true, inserted, models_needing_update: result.models_needing_update };

    } catch(e) {
      try {
        await pool.query(
          'INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status) VALUES ($1,$2,$3,$4,$5,$6)',
          [this.name,'run','{}',JSON.stringify({error:e.message}),0,'failed']
        );
      } catch(_) {}
      return { success: false, error: e.message };
    }
  }
}

export const benchmarkRunnerAgent = new BenchmarkRunnerAgent();
export default benchmarkRunnerAgent;