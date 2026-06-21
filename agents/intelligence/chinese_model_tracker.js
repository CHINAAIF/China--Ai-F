import { config } from 'dotenv'; config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';

class ChineseModelTrackerAgent {
  constructor() {
    this.name = 'chinese_model_tracker';
    this.layer = 'intelligence';
  }

  async run(input = {}) {
    try {
      const { rows: models } = await pool.query(
        `SELECT model_key, name_en, company FROM chinese_ai_models WHERE status='active' ORDER BY model_key LIMIT 5`
      );

      let tracked = 0;

      for (const model of models) {
        try {
          const result = await safeGroqJSON(
            `حلل آخر تطورات نموذج ${model.name_en} من ${model.company}. أجب بـ JSON: {event_type:"update",title:"عنوان",event_date:"2025-06-18",summary:"ملخص",confidence:75}`,
            null,
            this.name
          );

          if (!result.data) continue;

          const validTypes = ['release','update','benchmark','pricing_change','policy_change','acquisition','ban','approval','open_source','capability_added','capability_removed'];
          const eventType = validTypes.includes(result.data.event_type) ? result.data.event_type : 'update';

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await pool.query(
                `INSERT INTO model_timeline
                   (model_key, event_type, event_date, title, event_data, confidence, source_agent, version_number)
                 VALUES ($1,$2,$3::date,$4,$5,$6,$7,1)
                 ON CONFLICT DO NOTHING`,
                [
                  model.model_key,
                  eventType,
                  result.data.event_date || '2025-06-18',
                  result.data.title || `تحديث ${model.name_en}`,
                  JSON.stringify({ summary: result.data.summary }),
                  Math.min(100, Math.max(0, Math.round(result.data.confidence || 70))),
                  this.name
                ]
              );
              tracked++;
              break;
            } catch(e) {
              if (attempt < 2) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
            }
          }

          await pool.query(
            `INSERT INTO temporal_intelligence
               (subject_type, subject_key, metric_name, metric_text, measured_at, source_agent, confidence, version_number)
             VALUES ('model',$1,'development_status',$2,NOW(),$3,$4,1)`,
            [model.model_key, result.data.summary || '', this.name, Math.round(result.data.confidence || 70)]
          ).catch(() => {});

          await new Promise(r => setTimeout(r, 500));
        } catch(e) { continue; }
      }

      await pool.query(
        `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status)
         VALUES ($1,'track',$2,$3,$4,'completed')`,
        [this.name, JSON.stringify(input), JSON.stringify({tracked}), 80]
      ).catch(() => {});

      return { success: true, data: { tracked, models: models.length, confidence: 80 } };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }
}

export const chineseModelTracker = new ChineseModelTrackerAgent();
export default chineseModelTracker;
export async function run(input = {}) { return chineseModelTracker.run(input); }
