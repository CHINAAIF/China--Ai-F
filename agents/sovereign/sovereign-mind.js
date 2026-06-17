import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class SovereignMind {
  constructor() { this.name = 'sovereign_mind'; this.layer = 'sovereign'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }

  async think(userInput, context = {}) {
    try {
      const models = await pool.query('SELECT model_key,provider,model_name,priority FROM model_registry_sovereign WHERE is_active=true ORDER BY priority LIMIT 12');
      const result = await safeGroqJSON(`أنت العقل السيادي لمنصة استخبارات AI عالمية. أنت المستشار الاستراتيجي الأول. لديك ${models.rows.length} نموذج تحت إمرتك: ${JSON.stringify(models.rows)}. السياق: ${JSON.stringify(context)}. المدخل: ${userInput}. أجب بـ JSON: {decision:string,strategy:string,action_required:boolean,executive_command:object,priority:string,models_to_consult:array,confidence:number}`);
      if(!result.data) return { success:false, error:result.error };

      const op = await pool.query(
        `INSERT INTO sovereign_operations (operation_type,strategic_context,decision,models_consulted,consensus_score,status)
         VALUES ($1,$2,$3,$4,$5,'completed') RETURNING id`,
        ['strategic_analysis', JSON.stringify({input:userInput,context}), result.data.decision, result.data.models_to_consult||[], Math.round(result.data.confidence||75)]
      );
      return { success:true, operation_id:op.rows[0].id, data:result.data };
    } catch(e) { return { success:false, error:e.message }; }
  }

  async runDiagnostic() { const r = await this.think('فحص تشخيصي',{test:true}); return { agent:this.name, status:r.success?'ok':'error', ...r }; }
}

export const sovereignMind = new SovereignMind();
export default sovereignMind;
