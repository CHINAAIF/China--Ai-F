/**
 * fact_checker_agent | layer: analysis
 * منطق Groq حقيقي — يستخدم safe-json.js
 */
import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class FactCheckerAgent {
  constructor() {
    this.name = 'fact_checker_agent';
    this.layer = 'analysis';
    this.status = 'active';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    const prompt = `Verify facts about Chinese AI models, companies, and market data.

Input: ${JSON.stringify(input)}

Respond ONLY with JSON matching: {"verified":true,"facts":[{"claim":"...","status":"verified|unverified|false"}],"confidence":85}`;
    const result = await safeGroqJSON(prompt);
    if (!result.data) return { success: false, error: result.error, raw: result.raw };

    try {
      await pool.query(
        `INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
         VALUES ($1,'analyze',$2,$3,$4,'completed')`,
        [this.name, JSON.stringify(input), JSON.stringify(result.data), result.data.confidence || 75]
      );
    } catch(e) { console.warn('⚠️ log_fail (متابعة):', e.message); }

    return { success: true, data: result.data, retried: result.retried };
  }

  async runDiagnostic() {
    const r = await this.run({ test: true, query: 'diagnostic' });
    return { agent: this.name, layer: this.layer, status: r.success?'ok':'error', ...r };
  }
}

export const factCheckerAgent = new FactCheckerAgent();
export default factCheckerAgent;
