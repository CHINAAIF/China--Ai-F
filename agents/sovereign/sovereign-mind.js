import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

class SovereignMind {
  constructor() { this.name = 'sovereign_mind'; this.layer = 'sovereign'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }

  async think(userInput, context = {}) {
    try {
      const models = await pool.query('SELECT model_key,provider,model_name,priority FROM model_registry_sovereign WHERE is_active=true ORDER BY priority LIMIT 12');
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: `أنت العقل السيادي لمنصة استخبارات AI عالمية. أنت المستشار الاستراتيجي الأول. لديك ${models.rows.length} نموذج تحت إمرتك. قرارك نهائي. أجب بـ JSON: {decision:string,strategy:string,action_required:boolean,executive_command:object|null,priority:string,models_to_consult:array,confidence:number}`,
        messages: [{ role: 'user', content: `السياق: ${JSON.stringify(context)}\nالمدخل: ${userInput}\nالنماذج المتاحة: ${JSON.stringify(models.rows)}` }]
      });
      const text = msg.content.map(b=>b.text||'').join('');
      let data;
      try { data = JSON.parse(text.replace(/```json|```/g,'').trim()); }
      catch(e) { data = { decision: text, strategy: 'direct', action_required: false, confidence: 75 }; }

      const op = await pool.query(
        `INSERT INTO sovereign_operations (operation_type,strategic_context,decision,models_consulted,consensus_score,status)
         VALUES ($1,$2,$3,$4,$5,'completed') RETURNING id`,
        ['strategic_analysis', JSON.stringify({input:userInput,context}), data.decision, data.models_to_consult||[], Math.round(data.confidence||75)]
      );
      return { success:true, operation_id: op.rows[0].id, data };
    } catch(e) { return { success:false, error:e.message }; }
  }

  async runDiagnostic() { const r = await this.think('فحص تشخيصي للمنصة',{test:true}); return { agent:this.name, status:r.success?'ok':'error', ...r }; }
}

export const sovereignMind = new SovereignMind();
export default sovereignMind;
