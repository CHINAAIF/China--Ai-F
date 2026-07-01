/**
 * china_investment_agent | layer: intelligence
 * منطق Groq حقيقي — يستخدم safe-json.js
 */
import dotenv from 'dotenv'; dotenv.config();
import { pool } from './db-intelligence.js';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

class ChinaInvestmentAgent {
  constructor() {
    this.name = 'china_investment_agent';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    const prompt = `Track and analyze investments in Chinese AI sector: VCs, government funding, IPOs.\n\nInput: ${JSON.stringify(input)}\n\nRespond ONLY with JSON: {"investments":[{"company":"...","amount":"...","investor":"...","date":"..."}],"total_volume":"...","confidence":85}`;
    const result = await safeGroqJSON(prompt);
    if (!result.data) return { success: false, error: result.error, raw: result.raw };
    try {
      await pool.query(
        `INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
         VALUES ($1,'analyze',$2,$3,$4,'completed')`,
        [this.name, JSON.stringify(input), JSON.stringify(result.data), Math.round(result.data.confidence||75)]
      );
    } catch(e) { console.warn('⚠️ log_fail (متابعة):', e.message); }
    return { success: true, data: result.data, retried: result.retried };
  }

  async runDiagnostic() {
    const r = await this.run({ test: true });
    return { agent: this.name, layer: this.layer, status: r.success?'ok':'error', ...r };
  }
}

export const chinaInvestmentAgent = new ChinaInvestmentAgent();
export default chinaInvestmentAgent;
