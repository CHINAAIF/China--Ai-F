import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class ApprovalAgent {
  constructor() { this.name = 'approval_agent'; this.layer = 'learning'; this.status = 'active'; }
  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }
  async run(input = {}) {
    try {
      const result = await safeGroqJSON(`أنت وكيل موافقة على بيانات التعلم. راجع البيانات المقترحة وقرر الموافقة أو الرفض بناءً على الجودة والدقة والأهمية لمنصة استخبارات AI. البيانات: ${JSON.stringify(input)}. أجب بـ JSON: {approved:boolean,final_confidence:number,knowledge_extracted:{key_insights:array,patterns:array},reason:string}`);
      if (!result.data) return { success: false, error: result.error };
      try {
        await pool.query(
          `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status) VALUES ($1,'approve',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify(input), JSON.stringify(result.data), Math.min(100,Math.max(0,Math.round(result.data.final_confidence||75)))]
        );
      } catch(e) { console.warn('⚠️ log_fail:', e.message); }
      return { success: true, data: result.data };
    } catch(e) { return { success: false, error: e.message }; }
  }
  async runDiagnostic() { const r = await this.run({test:true,candidate:'sample approval'}); return { agent: this.name, status: r.success?'ok':'error', ...r }; }
}

export const approvalAgent = new ApprovalAgent();
export default approvalAgent;
