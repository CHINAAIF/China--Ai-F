/**
 * competitor_analysis_agent | layer: analysis
 * منطق Groq حقيقي — يستخدم safe-json.js
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class CompetitorAnalysisAgent {
  constructor() {
    this.name = 'competitor_analysis_agent';
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
    const prompt = `Analyze competitors in the Chinese AI market. Identify strengths, weaknesses, market position.

Input: ${JSON.stringify(input)}

Respond ONLY with JSON matching: {"competitors":[{"name":"...","strength":"...","weakness":"..."}],"market_leader":"...","confidence":85}`;
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

export const competitorAnalysisAgent = new CompetitorAnalysisAgent();
export default competitorAnalysisAgent;
