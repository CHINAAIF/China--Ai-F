import { logExecution, safeStep } from '../utils/executor.js';
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized: true } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class EUModelsAgent {
  constructor() {
    this.name = 'eu_models_agent';
    this.layer = 'intelligence';
    this.status = 'active';
    this.vendors = ['mistral','cohere'];
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    try {
      const vendorRows = await pool.query('SELECT id, slug FROM vendors WHERE slug = ANY($1)', [this.vendors]);
      const vendors = {};
      for (const r of vendorRows.rows) vendors[r.slug] = r.id;

      const modelRows = await pool.query(
        'SELECT id, slug FROM models WHERE vendor_id = ANY($1) AND status = $2',
        [Object.values(vendors), 'active']
      );

      const prompt = `أنت محلل متخصص في نماذج الذكاء الاصطناعي الأوروبية.
الشركات: Mistral (فرنسا), Cohere (كندا/أوروبا)
النماذج الحالية: ${modelRows.rows.map(m => m.slug).join(', ')}
حلل الحالة الراهنة وأجب بـJSON فقط بدون أي نص خارجه:
{
  "signals": [
    {
      "vendor": "mistral",
      "model_slug": "mistral-large-2",
      "signal_type": "pricing_update",
      "title": "عنوان",
      "content": "وصف تفصيلي",
      "confidence": 80,
      "impact_level": "medium"
    }
  ],
  "market_summary": "ملخص",
  "confidence": 75
}`;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
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
        [this.name, 'run', JSON.stringify({ vendors: this.vendors }),
         JSON.stringify({ inserted, market_summary: result.market_summary }),
         Math.min(100, Math.max(0, Math.round(result.confidence || 75))), 'completed']
      );

      console.log('eu_models_agent: inserted', inserted, 'signals');
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

export const euModelsAgent = new EUModelsAgent();
export default euModelsAgent;