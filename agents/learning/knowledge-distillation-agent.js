import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { distill } from '../utils/knowledge-distiller.js';
import { safeGroqJSON } from '../utils/safe-json.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

class KnowledgeDistillationAgent {
  constructor() {
    this.name  = 'knowledge_distillation_agent';
    this.layer = 'learning';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  async run(input = {}) {
    try {
      // ── سحب القرارات الناجحة غير المقطّرة ──────────────────
      const { rows } = await pool.query(`
        SELECT agent_name, action, output, confidence
        FROM agent_execution_logs
        WHERE status='completed'
          AND confidence >= 80
          AND created_at > NOW() - INTERVAL '6 hours'
          AND agent_name != $1
        ORDER BY confidence DESC
        LIMIT 20
      `, [this.name]);

      if (rows.length === 0) return { success: true, data: { distilled: 0 } };

      let distilled = 0;
      for (const row of rows) {
        try {
          // ── تقطير عميق: استخراج القاعدة الصلبة ─────────────
          const rule = await safeGroqJSON(`
            Extract a reusable knowledge rule from this successful AI decision:
            Agent: ${row.agent_name}
            Action: ${row.action}
            Output: ${JSON.stringify(row.output).slice(0, 300)}
            Confidence: ${row.confidence}
            Return JSON: {
              "rule": "one clear reusable rule statement",
              "domain": "financial|analysis|security|content|service",
              "applies_to": ["agent_type"],
              "confidence": 0-100
            }
          `, 'llama-3.1-8b-instant', this.name);

          if (rule.data?.rule && rule.data.confidence >= 80) {
            await distill(
              row.agent_name,
              rule.data.rule,
              rule.data,
              Math.min(100, Math.max(0, Math.round(rule.data.confidence)))
            );
            distilled++;
          }
        } catch(_) {}
      }

      await pool.query(`
        INSERT INTO agent_execution_logs
          (agent_name,action,input,output,confidence,status)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        this.name, 'distill_cycle',
        JSON.stringify({ processed: rows.length }),
        JSON.stringify({ distilled }),
        85, 'completed'
      ]).catch(()=>{});

      return { success: true, data: { processed: rows.length, distilled } };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({});
    return { agent: this.name, status: r.success ? 'ok' : 'error', ...r };
  }
}

export const knowledgeDistillationAgent = new KnowledgeDistillationAgent();
export default knowledgeDistillationAgent;
