/**
 * prompt_optimizer_agent | layer: content
 * منطق Groq حقيقي — يستخدم safe-json.js
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class PromptOptimizerAgent {
  constructor() {
    this.name = 'prompt_optimizer_agent';
    this.layer = 'content';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    const prompt = `Optimize prompts for better AI model outputs in the intelligence pipeline.\n\nInput: ${JSON.stringify(input)}\n\nRespond ONLY with JSON: {"optimized_prompt":"...","improvements":[],"expected_quality_gain":0,"confidence":85}`;
    const result = await safeGroqJSON(prompt);
    if (!result.data) return { success: false, error: result.error, raw: result.raw };
    try {
      await pool.query(
        `INSERT INTO agent_execution_logs (agent_name, action, input, output, confidence, status)
         VALUES ($1,'run',$2,$3,$4,'completed')`,
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

export const promptOptimizerAgent = new PromptOptimizerAgent();
export default promptOptimizerAgent;
