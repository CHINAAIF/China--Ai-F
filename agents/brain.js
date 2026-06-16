import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

export class ChinaAIFBrain {
  
  // تغذية العقل بمعرفة مصفاة فقط
  async learn(approvedId, memoryType = 'signal') {
    // ضمان توافق النوع مع قيد السكيما المعتمد
    const allowedTypes = ['signal', 'insight', 'fact'];
    const finalType = allowedTypes.includes(memoryType) ? memoryType : 'signal';
    const { rows } = await pool.query(
      `SELECT la.*, lc.data_type, lc.source_agent
       FROM learning_approved la
       JOIN learning_candidates lc ON lc.id = la.candidate_id
       WHERE la.id = $1 AND la.fed_to_brain = false`,
      [approvedId]
    );
    if (!rows[0]) return { skipped: true };

    const item = rows[0];
    
    await pool.query(
      `INSERT INTO brain_memory 
       (memory_type, context, decision_made, confidence_delta, learned_pattern, is_validated, validated_at)
       VALUES ($1, $2, $3, $4, $5, true, now())`,
      [
        item.data_type,
        JSON.stringify(item.knowledge_extracted),
        `Learned from agent: ${item.source_agent}`,
        item.final_confidence,
        JSON.stringify(item.knowledge_extracted)
      ]
    );

    await pool.query(
      `UPDATE learning_approved SET fed_to_brain=true, fed_at=now() WHERE id=$1`,
      [approvedId]
    );

    return { success: true, type: item.data_type };
  }

  // استعلام المعرفة
  async recall(topic, type = null) {
    let query = `SELECT * FROM platform_knowledge_base WHERE topic ILIKE $1`;
    const params = [`%${topic}%`];
    if (type) { query += ` AND knowledge_type = $2`; params.push(type); }
    query += ` ORDER BY confidence_score DESC LIMIT 5`;
    const { rows } = await pool.query(query, params);
    return rows;
  }

  // تسجيل نمط جديد تعلمه العقل
  async recordPattern(type, context, decision, confidence) {
    await pool.query(
      `INSERT INTO brain_memory (memory_type, context, decision_made, confidence_delta, is_validated)
       VALUES ($1, $2, $3, $4, false)`,
      [type, JSON.stringify(context), decision, confidence]
    );
  }

  // إحصاءات العقل
  async stats() {
    const { rows } = await pool.query(`
      SELECT 
        COUNT(*) as total_memories,
        COUNT(*) FILTER (WHERE is_validated = true) as validated,
        COUNT(*) FILTER (WHERE is_validated = false) as pending,
        AVG(confidence_delta) as avg_confidence
      FROM brain_memory
    `);
    return rows[0];
  }
}

export const brain = new ChinaAIFBrain();
export default brain;
