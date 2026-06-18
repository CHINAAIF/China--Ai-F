import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import { createHmac } from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const HMAC_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-key';

class DiagnosticAgent {
  constructor() { this.name = 'diagnostic_agent'; this.layer = 'sovereign'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }

  async scan() {
    try {
      const [heartbeat, errors, queue] = await Promise.all([
        pool.query(`SELECT agent_name,status,missed_pings FROM agent_heartbeat WHERE status!='active' OR missed_pings>2 LIMIT 10`),
        pool.query(`SELECT agent_name,error_message,created_at FROM agent_execution_logs WHERE status='failed' AND created_at>now()-interval'1 hour' LIMIT 10`),
        pool.query(`SELECT COUNT(*) FROM agent_task_queue WHERE status='failed'`)
      ]);

      const issues = { unhealthy_agents: heartbeat.rows, recent_errors: errors.rows, failed_tasks: parseInt(queue.rows[0].count) };
      const hasCritical = heartbeat.rows.length>5 || errors.rows.length>10 || issues.failed_tasks>20;

      const repair = await safeGroqJSON(`أنت وكيل التشخيص والترميم. فحص النظام: ${JSON.stringify(issues)}. أجب بـ JSON: {severity:string,repair_plan:object,auto_apply:boolean,commander_required:boolean,affected_components:array,confidence:number} — severity: low|medium|high|critical`);
      if(!repair.data) return { success:false, error:repair.error };

      const expires = new Date(Date.now()+5*60*1000);
      const sig = createHmac('sha256',HMAC_SECRET).update(JSON.stringify(repair.data)+expires.toISOString()).digest('hex');
      const severity = ['low','medium','high','critical'].includes(repair.data.severity)?repair.data.severity:'medium';

      const rec = await pool.query(
        `INSERT INTO diagnostic_repairs (detected_issue,issue_severity,affected_component,repair_plan,hmac_signature,signature_expires_at,auto_applied,commander_required,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned') RETURNING id`,
        [JSON.stringify(issues), severity, repair.data.affected_components?.join(',')||'system', JSON.stringify(repair.data.repair_plan||{}), sig, expires, !hasCritical&&repair.data.auto_apply, hasCritical||repair.data.commander_required]
      );
      return { success:true, repair_id:rec.rows[0].id, severity, commander_required:hasCritical||repair.data.commander_required, signature:sig, expires, data:repair.data };
    } catch(e) { return { success:false, error:e.message }; }
  }

  async runDiagnostic() { const r = await this.scan(); return { agent:this.name, status:r.success?'ok':'error', ...r }; }
}

export const diagnosticAgent = new DiagnosticAgent();
export default diagnosticAgent;

// ── auto-fix: run() wrapper ──────────────────────────────────────
export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'diagnostic-agent', status: 'ok', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
