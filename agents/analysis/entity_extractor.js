import { logExecution, safeStep } from '../utils/executor.js';
import { config } from 'dotenv'; config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { createHash } from 'crypto';

function entityHash(name, type) {
  return createHash('sha256')
    .update(name.toLowerCase().replace(/[^\w\u0600-\u06ff\u4e00-\u9fff]/g,'').trim() + ':' + type)
    .digest('hex');
}

class EntityExtractorAgent {
  constructor() {
    this.name = 'entity_extractor';
    this.layer = 'analysis';
  }

  async run(input = {}) {
    try {
      const { rows } = await pool.query(
        `SELECT id, title, raw_content, content
         FROM intelligence_raw
         WHERE is_verified=true
         ORDER BY collected_at DESC
         LIMIT 10`
      );

      let extracted = 0, duplicates = 0;
      const validTypes = ['company','model','person','government_body','regulation','research_lab','investment_fund','university'];

      for (const item of rows) {
        try {
          const text = (item.title || '') + ' ' + (item.raw_content || item.content || '');
          if (!text.trim()) continue;

          const result = await safeGroqJSON(
            `استخرج الكيانات من: "${text.slice(0,400)}". أجب بـ JSON: {entities:[{name:"اسم",type:"company|model|person|government_body|regulation|research_lab",country:"CN"}],confidence:80}`,
            null,
            this.name
          );

          if (!result.data?.entities?.length) continue;

          for (const entity of result.data.entities) {
            if (!entity.name || !entity.type) continue;
            const type = validTypes.includes(entity.type) ? entity.type : 'company';
            const hash = entityHash(entity.name, type);

            try {
              await pool.query(
                `INSERT INTO entities
                   (entity_type, name_en, country, entity_identity_hash, occurrence_count, last_seen, verified)
                 VALUES ($1,$2,$3,$4,1,NOW(),false)
                 ON CONFLICT (entity_identity_hash) DO UPDATE SET
                   last_seen=NOW(),
                   occurrence_count=entities.occurrence_count+1`,
                [type, entity.name, entity.country || 'CN', hash]
              );
              extracted++;
            } catch(e) { duplicates++; }
          }

          await new Promise(r => setTimeout(r, 300));
        } catch(e) { continue; }
      }

      await pool.query(
        `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status)
         VALUES ($1,'extract',$2,$3,$4,'completed')`,
        [this.name, JSON.stringify(input), JSON.stringify({extracted, duplicates}), 80]
      ).catch(() => {});

      return { success: true, data: { extracted, duplicates, processed: rows.length, confidence: 80 } };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }
}

export const entityExtractor = new EntityExtractorAgent();
export default entityExtractor;
export async function run(input = {}) { return entityExtractor.run(input); }
