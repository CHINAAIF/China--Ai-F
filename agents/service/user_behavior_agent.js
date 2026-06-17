import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
class Agent {
  constructor() { this.name = 'user_behavior_agent'; this.layer = 'service'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }
  async run(input = {}) {
    try {
      const result = await safeGroqJSON(`أنت وكيل سلوك المستخدم. حلل أنماط الاستخدام وخرائط الحرارة ومسارات التنقل واستخرج رؤى قابلة للتنفيذ. البيانات: ${JSON.stringify(input)}. أجب بـ JSON: {analysis:string,recommendations:array,confidence:number,action_taken:string}`);
      if (!result.data) return { success:false, error:result.error };
      try {
        await pool.query(
          `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,'analyze',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify(input), JSON.stringify(result.data), Math.min(100,Math.max(0,Math.round(result.data.confidence||75)))]
        );
      } catch(e) { console.warn('⚠️ log_fail:', e.message); }
      return { success:true, data:result.data };
    } catch(e) { return { success:false, error:e.message }; }
  }
  async runDiagnostic() { const r = await this.run({test:true}); return { agent:this.name, status:r.success?'ok':'error', ...r }; }
}
const agent = new Agent();
export default agent;
export { agent as userBehaviorAgent };
