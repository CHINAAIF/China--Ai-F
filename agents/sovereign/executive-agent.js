import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { createHmac } from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const HMAC_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-key';

class ExecutiveAgent {
  constructor() { this.name = 'executive_agent'; this.layer = 'sovereign'; this.status = 'active'; }
  async initialize() { try { await pool.query('SELECT 1'); return true; } catch(e) { this.status='db_error'; return false; } }

  generateSignature(payload) {
    const expires = new Date(Date.now() + 5*60*1000);
    const sig = createHmac('sha256', HMAC_SECRET).update(JSON.stringify(payload)+expires.toISOString()).digest('hex');
    return { sig, expires };
  }

  async prepareCommand(operationId, commandType, payload) {
    try {
      const analysis = await safeGroqJSON(`أنت الوكيل التنفيذي. حلل هذا الأمر وجهّزه للتنفيذ. النوع: ${commandType}. الحمولة: ${JSON.stringify(payload)}. أجب بـ JSON: {prepared_payload:object,risk_level:string,sandbox_required:boolean,estimated_impact:string,confidence:number}`);
      if(!analysis.data) return { success:false, error:analysis.error };

      const { sig, expires } = this.generateSignature(payload);
      const cmd = await pool.query(
        `INSERT INTO executive_commands (operation_id,command_type,payload,sandbox_result,hmac_signature,signature_expires_at,status)
         VALUES ($1,$2,$3,$4,$5,$6,'sandbox') RETURNING id`,
        [operationId||null, commandType, JSON.stringify(payload), JSON.stringify(analysis.data), sig, expires]
      );
      return { success:true, command_id:cmd.rows[0].id, signature:sig, expires, data:analysis.data };
    } catch(e) { return { success:false, error:e.message }; }
  }

  async runDiagnostic() {
    const r = await this.prepareCommand(null,'code',{test:true,action:'diagnostic'});
    return { agent:this.name, status:r.success?'ok':'error', ...r };
  }
}

export const executiveAgent = new ExecutiveAgent();
export default executiveAgent;
