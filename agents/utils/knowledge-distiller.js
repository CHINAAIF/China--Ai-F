import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function distill(agentName, prompt, responseData, confidence) {
  if (!responseData || confidence < 80) return;

  try {
    const ruleText = typeof responseData === 'string'
      ? responseData.slice(0, 500)
      : JSON.stringify(responseData).slice(0, 500);

    const ruleHash = crypto.createHash('sha256')
      .update(agentName + ruleText)
      .digest('hex').slice(0, 64);

    const queryHash = crypto.createHash('sha256')
      .update(prompt.trim().toLowerCase())
      .digest('hex').slice(0, 64);

    // حفر في الذاكرة السيادية
    await pool.query(`
      INSERT INTO sovereign_memory_local
        (query_hash, query_text, response_data, model_used, confidence, verified)
      VALUES ($1,$2,$3,$4,$5,true)
      ON CONFLICT (query_hash) DO UPDATE
        SET usage_count = sovereign_memory_local.usage_count + 1,
            last_used   = NOW(),
            confidence  = GREATEST(sovereign_memory_local.confidence, EXCLUDED.confidence)
    `, [
      queryHash,
      prompt.slice(0, 1000),
      typeof responseData === 'object' ? responseData : { raw: responseData },
      agentName,
      Math.min(100, Math.max(0, Math.round(confidence)))
    ]);

    // حفر كقاعدة صلبة
    await pool.query(`
      INSERT INTO knowledge_distillation
        (rule_hash, rule_text, source_agent, confidence, is_permanent)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (rule_hash) DO UPDATE
        SET applied_count = knowledge_distillation.applied_count + 1
    `, [
      ruleHash,
      ruleText,
      agentName,
      Math.min(100, Math.max(0, Math.round(confidence))),
      confidence >= 90
    ]);

  } catch(e) {
    console.warn('distill error:', e.message);
  }
}

export default { distill };
