import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class GroundTruthValidator {
  constructor() {
    this.name = 'ground_truth_validator';
    this.layer = 'learning';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async updateSourceReputation(domain, wasAccurate, delta) {
    try {
      await pool.query(`
        INSERT INTO source_reputation (domain_url, reputation_score, total_checks, accurate_checks)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (domain_url) DO UPDATE SET
          reputation_score = LEAST(100, GREATEST(0, source_reputation.reputation_score + $4)),
          total_checks = source_reputation.total_checks + 1,
          accurate_checks = source_reputation.accurate_checks + $3,
          updated_at = now()
      `, [domain, wasAccurate ? 60 : 40, wasAccurate ? 1 : 0, delta]);
    } catch(e) { console.warn('reputation_update failed:', e.message); }
  }

  async run(input = {}) {
    try {
      // 1. جلب intelligence_verified غير منشور للتحقق
      const items = await pool.query(`
        SELECT iv.id, iv.raw_id, iv.verified_content, iv.impact_level,
               ir.agent_name, ir.title, ir.confidence, ir.signals
        FROM intelligence_verified iv
        JOIN intelligence_raw ir ON iv.raw_id = ir.id
        WHERE iv.published = false
        ORDER BY iv.created_at ASC
        LIMIT 10
      `);

      if (!items.rows.length) {
        return { success: true, message: 'no_items_to_validate', validated: 0 };
      }

      let validated = 0;
      let published = 0;
      const results = [];

      for (const item of items.rows) {
        try {
          const content = item.verified_content;
          const prompt = `أنت محلل تحقق من الحقيقة.
المهمة: تقييم هذه المعلومة وتحديد مصداقيتها.
العنوان: ${item.title || content?.title || 'بدون عنوان'}
المحتوى: ${content?.content || JSON.stringify(content).slice(0,400)}
مستوى الأثر: ${item.impact_level}
الثقة الأولية: ${item.confidence}

قيّم:
1. هل المعلومة قابلة للتحقق؟
2. هل تتسق مع المعرفة العامة عن النماذج والشركات؟
3. هل يجب نشرها؟

أجب بـJSON فقط بدون أي نص خارجه:
{
  "is_valid": true,
  "confidence_adjusted": 80,
  "should_publish": true,
  "validation_notes": "ملاحظات التحقق",
  "impact_confirmed": "low|medium|high|critical"
}`;

          const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 500,
          });

          let verdict;
          try {
            const text = completion.choices[0].message.content;
            const clean = text.replace(/```json|```/g, '').trim();
            verdict = JSON.parse(clean);
          } catch(e) { throw new Error('JSON parse failed: ' + e.message); }

          validated++;

          if (verdict.should_publish && verdict.is_valid) {
            await pool.query(`
              UPDATE intelligence_verified
              SET published = true, published_at = now(),
                  impact_level = $1
              WHERE id = $2
            `, [verdict.impact_confirmed || item.impact_level, item.id]);
            published++;
            results.push({ title: item.title, status: 'published', confidence: verdict.confidence_adjusted });
          } else {
            results.push({ title: item.title, status: 'held', notes: verdict.validation_notes });
          }

        } catch(e) {
          console.warn('item validation failed:', e.message);
          results.push({ id: item.id, status: 'error', error: e.message });
        }
      }

      await pool.query(`
        INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        this.name, 'validate',
        JSON.stringify({ items_checked: items.rows.length }),
        JSON.stringify({ validated, published, results }),
        Math.min(100, Math.max(0, validated > 0 ? 85 : 50)),
        'completed'
      ]);

      const total = await pool.query(`SELECT COUNT(*) as c FROM intelligence_verified WHERE published = true`);
      console.log('ground_truth_validator: validated=' + validated + ' published=' + published + ' total_published=' + total.rows[0].c);
      return { success: true, validated, published, results };

    } catch(e) {
      try {
        await pool.query(`
          INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [this.name,'validate','{}',JSON.stringify({error:e.message}),0,'failed']);
      } catch(_) {}
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({ test: true });
    return { agent: this.name, status: r.success ? 'ok' : 'error', ...r };
  }
}

export const groundTruthValidator = new GroundTruthValidator();
export default groundTruthValidator;