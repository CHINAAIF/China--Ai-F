import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class USModelsAgent {
  constructor() {
    this.name = 'us_models_agent';
    this.layer = 'intelligence';
    this.status = 'active';
    this.vendors = ['openai','anthropic','google','meta','xai'];
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    const startedAt = new Date();
    try {
      const vendorRows = await pool.query(
        'SELECT id, slug FROM vendors WHERE slug = ANY($1)',
        [this.vendors]
      );
      const vendors = {};
      for (const r of vendorRows.rows) vendors[r.slug] = r.id;

      const modelRows = await pool.query(
        'SELECT id, slug, name FROM models WHERE vendor_id = ANY($1) AND status = $2',
        [Object.values(vendors), 'active']
      );

      const prompt = `أنت محلل ذكاء اصطناعي متخصص في تتبع نماذج الشركات الأمريكية.
الشركات: OpenAI, Anthropic, Google, Meta, xAI
النماذج الحالية في قاعدة البيانات: ${modelRows.rows.map(m => m.slug).join(', ')}

مهمتك: تحليل الحالة الراهنة لهذه النماذج وتحديد:
1. أي تغييرات تسعير حديثة
2. أي قدرات جديدة أُضيفت
3. أي نماذج جديدة أُطلقت في 2025-2026
4. مستوى المنافسة الحالي بين هذه الشركات

أجب بـJSON فقط بهذا الشكل:
{
  "signals": [
    {
      "vendor": "openai",
      "model_slug": "gpt-4o",
      "signal_type": "pricing_update|capability_added|new_release|performance_update",
      "title": "عنوان الإشارة",
      "content": "وصف تفصيلي",
      "confidence": 85,
      "impact_level": "low|medium|high|critical"
    }
  ],
  "market_summary": "ملخص الحالة التنافسية",
  "confidence": 80
}`;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      });

      let result;
      try {
        const text = completion.choices[0].message.content;
        const clean = text.replace(/```json|\n|```/g, '').trim();
        result = JSON.parse(clean);
      } catch(e) {
        throw new Error('JSON parse failed: ' + e.message);
      }

      let inserted = 0;
      for (const signal of (result.signals || [])) {
        try {
          await pool.query(`
            INSERT INTO intelligence_raw 
              (agent_name, content_type, raw_content, title, confidence, filter_status, signals)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            this.name,
            signal.signal_type,
            signal.content,
            signal.title,
            Math.min(100, Math.max(0, signal.confidence || 75)),
            'pending',
            JSON.stringify({ vendor: signal.vendor, model: signal.model_slug, impact: signal.impact_level })
          ]);
          inserted++;
        } catch(e) {
          console.warn('insert signal failed:', e.message);
        }
      }

      await pool.query(`
        INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        this.name, 'run',
        JSON.stringify({ vendors: this.vendors }),
        JSON.stringify({ inserted, market_summary: result.market_summary }),
        Math.min(100, Math.max(0, Math.round(result.confidence || 75))),
        'completed'
      ]);

      console.log('us_models_agent: inserted', inserted, 'signals');
      return { success: true, inserted, market_summary: result.market_summary };

    } catch(e) {
      try {
        await pool.query(`
          INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [this.name, 'run', '{}', JSON.stringify({ error: e.message }), 0, 'failed']);
      } catch(_) {}
      return { success: false, error: e.message };
    }
  }
}

export const usModelsAgent = new USModelsAgent();
export default usModelsAgent;