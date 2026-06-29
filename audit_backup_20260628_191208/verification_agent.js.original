import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class LearningVerificationAgent {
  constructor() { this.name = 'learning_verification_agent'; this.layer = 'learning'; this.status = 'active'; }
  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }
  async run(input = {}) {
    try {
      const result = await safeGroqJSON(`أنت وكيل تحقق من جودة التعلم. تحقق من صحة الأنماط المكتسبة ودقتها. البيانات: ${JSON.stringify(input)}. أجب بـ JSON: {is_valid:boolean,verification_score:number,issues:array,recommendations:array,confidence:number}`);
      if (!result.data) return { success: false, error: result.error };
      try {
        await pool.query(
          `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,'verify',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify(input), JSON.stringify(result.data), Math.min(100,Math.max(0,Math.round(result.data.confidence||75)))]
        );
      } catch(e) { console.warn('⚠️ log_fail:', e.message); }
      return { success: true, data: result.data };
    } catch(e) { return { success: false, error: e.message }; }
  }
  async runDiagnostic() { const r = await this.run({test:true,pattern:'verification test'}); return { agent: this.name, status: r.success?'ok':'error', ...r }; }
}

export const learningVerificationAgent = new LearningVerificationAgent();
export default learningVerificationAgent;
