import { logExecution, safeStep } from '../utils/executor.js';
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class PricingOracleAgent {
  constructor() {
    this.name = 'pricing_oracle_agent';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    try {
      const models = await pool.query(`
        SELECT m.slug, m.name->>'en' as name_en, v.slug as vendor,
               mpt.price, mpt.unit, mpt.tier_name
        FROM models m
        JOIN vendors v ON m.vendor_id = v.id
        LEFT JOIN model_pricing_tiers mpt ON mpt.model_id = m.id AND mpt.active = true
        WHERE m.status = 'active'
        ORDER BY v.slug, m.slug
        LIMIT 30
      `);

      const prompt = `أنت محلل أسعار نماذج الذكاء الاصطناعي.
البيانات الحالية في قاعدة البيانات:
${models.rows.map(r => r.slug + ' | ' + r.vendor + ' | ' + (r.price || 'N/A') + ' ' + (r.unit || '')).join('\n')}

مهمتك: تحديد أي تغييرات تسعير حديثة أو تناقضات في الأسعار.
أجب بـJSON فقط بدون أي نص خارجه:
{
  "signals": [
    {
      "vendor": "openai",
      "model_slug": "gpt-4o",
      "signal_type": "pricing_update",
      "title": "عنوان التغيير",
      "content": "وصف تفصيلي للتغيير",
      "confidence": 85,
      "impact_level": "medium"
    }
  ],
  "pricing_summary": "ملخص حالة الأسعار",
  "confidence": 80
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
             JSON.stringify({ vendor: signal.vendor, model: signal.model_slug, impact: signal.impact_level })]
          );
          inserted++;
        } catch(e) { console.warn('insert failed:', e.message); }
      }

      await pool.query(
        'INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status) VALUES ($1,$2,$3,$4,$5,$6)',
        [this.name, 'run', '{}',
         JSON.stringify({ inserted, pricing_summary: result.pricing_summary }),
         Math.min(100, Math.max(0, Math.round(result.confidence || 75))), 'completed']
      );

      console.log('pricing_oracle_agent: inserted', inserted, 'signals');
      return { success: true, inserted };

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

export const pricingOracleAgent = new PricingOracleAgent();
export default pricingOracleAgent;