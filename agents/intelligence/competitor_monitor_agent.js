/**
 * competitor_monitor_agent | layer: intelligence
 * منطق Groq حقيقي — يستخدم safe-json.js
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class CompetitorMonitorAgent {
  constructor() {
    this.name = 'competitor_monitor_agent';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    const prompt = `Monitor Chinese AI competitors vs global players: DeepSeek, Qwen, Baidu ERNIE vs OpenAI, Anthropic, Google.\n\nInput: ${JSON.stringify(input)}\n\nRespond ONLY with JSON: {"comparisons":[{"chinese":"...","global":"...","chinese_advantage":"...","global_advantage":"..."}],"leading":"chinese|global|tied","confidence":85}`;
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

export const competitorMonitorAgent = new CompetitorMonitorAgent();
export default competitorMonitorAgent;
