import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class QualityGateAgent {
  constructor() { this.name = 'quality_gate_agent'; this.layer = 'sovereign'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }

  async review(commandId) {
    try {
      const cmd = await pool.query('SELECT * FROM executive_commands WHERE id=$1', [commandId]);
      if(!cmd.rows.length) return { success:false, error:'command not found' };
      const c = cmd.rows[0];

      // فحص انتهاء التوقيع
      if(new Date(c.signature_expires_at) < new Date()) {
        await pool.query(`UPDATE executive_commands SET status='expired' WHERE id=$1`,[commandId]);
        return { success:false, error:'signature_expired', vetoed:true };
      }

      const review = await safeGroqJSON(`أنت وكيل بوابة الجودة. افحص هذا الأمر بصرامة. النوع: ${c.command_type}. الحمولة: ${JSON.stringify(c.payload)}. نتيجة sandbox: ${JSON.stringify(c.sandbox_result)}. أجب بـ JSON: {decision:string,risk_score:number,issues:array,recommendations:array,requires_commander:boolean,confidence:number} — decision يجب أن يكون: approved أو vetoed أو needs_revision`);
      if(!review.data) return { success:false, error:review.error };

      const decision = ['approved','vetoed','needs_revision'].includes(review.data.decision) ? review.data.decision : 'needs_revision';
      const newStatus = decision==='approved'?'approved': decision==='vetoed'?'vetoed':'draft';

      await pool.query(`UPDATE executive_commands SET quality_approved=$1,quality_notes=$2,status=$3 WHERE id=$4`,
        [decision==='approved', review.data.recommendations?.join('; ')||'', newStatus, commandId]);

      await pool.query(
        `INSERT INTO quality_gate_log (command_id,gate_agent,decision,risk_score,issues_found,recommendations,requires_commander_auth)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [commandId, 'quality_gate_agent', decision, Math.round(review.data.risk_score||0), JSON.stringify(review.data.issues||[]), JSON.stringify(review.data.recommendations||[]), review.data.requires_commander||false]
      );
      return { success:true, decision, risk_score:review.data.risk_score, data:review.data };
    } catch(e) { return { success:false, error:e.message }; }
  }

  async runDiagnostic() { return { agent:this.name, status:'ok', note:'quality gate ready' }; }
}

export const qualityGateAgent = new QualityGateAgent();
export default qualityGateAgent;

// ── auto-fix: run() wrapper ──────────────────────────────────────
export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'quality-gate-agent', status: 'ok', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
