import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class LearningAgent {
  constructor() { this.name = 'learning_agent'; this.layer = 'learning'; this.status = 'active'; }
  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }
  async run(input = {}) {
    try {
      const result = await safeGroqJSON(`أنت وكيل التعلم المركزي لمنصة استخبارات AI الصينية. استخرج الأنماط والرؤى من البيانات المدخلة وحوّلها إلى معرفة قابلة للتطبيق. البيانات: ${JSON.stringify(input)}. أجب بـ JSON: {learned_pattern:{type:string,description:string,applicability:string},memory_type:string,decision_made:string,outcome:string,confidence_delta:number,is_validated:boolean}`);
      if (!result.data) return { success: false, error: result.error };
      const validMemoryTypes = ['pricing_pattern','vendor_behavior','market_signal','content_insight','agent_performance','security_pattern','user_behavior','prediction_result'];
      const memType = validMemoryTypes.includes(result.data.memory_type) ? result.data.memory_type : 'agent_performance';
      try {
        await pool.query(
          `INSERT INTO brain_memory (memory_type,context,decision_made,outcome,confidence_delta,learned_pattern,is_validated,source_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [memType, JSON.stringify({input, timestamp: new Date()}), result.data.decision_made||'', result.data.outcome||'', Math.min(100,Math.max(-100,Math.round(result.data.confidence_delta||5))), JSON.stringify(result.data.learned_pattern||{}), result.data.is_validated||false, this.name]
        );
      } catch(e) { console.warn('⚠️ brain_memory_fail:', e.message); }
      try {
        await pool.query(
          `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,'learn',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify(input), JSON.stringify(result.data), Math.min(100,Math.max(0,75))]
        );
      } catch(e) { console.warn('⚠️ log_fail:', e.message); }
      return { success: true, data: result.data };
    } catch(e) { return { success: false, error: e.message }; }
  }
  async runDiagnostic() { const r = await this.run({test:true,pattern:'learning test'}); return { agent: this.name, status: r.success?'ok':'error', ...r }; }
}

export const learningAgent = new LearningAgent();
export default learningAgent;
