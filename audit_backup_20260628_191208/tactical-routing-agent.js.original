import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class TacticalRoutingAgent {
  constructor() {
    this.name   = 'tactical_routing_agent';
    this.layer  = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    try {
      const result = await safeGroqJSON(`
        You are a tactical routing agent. Analyze this request and decide optimal routing.
        Input: ${JSON.stringify(input)}
        Return JSON: {
          "decision": "cache|fast_model|heavy_model|sovereign",
          "model_recommended": "model_name",
          "reasoning": "brief",
          "priority": 1,
          "estimated_tokens": 100,
          "confidence": 85
        }
      `, null, this.name);

      if (!result.data) return { success: false, error: result.error };

      await pool.query(`
        INSERT INTO agent_execution_logs
          (agent_name,action,input,output,confidence,status)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        this.name, 'tactical_route',
        JSON.stringify(input),
        JSON.stringify(result.data),
        Math.min(100, Math.max(0, Math.round(result.data.confidence || 75))),
        'completed'
      ]).catch(()=>{});

      return { success: true, data: result.data };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({ test: true });
    return { agent: this.name, status: r.success ? 'ok' : 'error', ...r };
  }
}

export const tacticalRoutingAgent = new TacticalRoutingAgent();
export default tacticalRoutingAgent;
