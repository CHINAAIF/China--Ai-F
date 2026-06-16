import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

export class GovernanceLayer {

  // تحكيم متعدد النماذج
  async multiModelConsensus(taskType, inputData, modelResponses) {
    const responses = Object.values(modelResponses).filter(r => r !== null);
    const total = responses.length;
    const agreements = responses.filter(r => r.approved === true).length;
    
    const consensusReached = agreements >= Math.ceil(total * 0.6);
    
    await pool.query(
      `INSERT INTO model_consensus 
       (task_type, input_data, groq_response, gemini_response, 
        deepseek_response, mistral_response, consensus_reached, consensus_result, disagreement_log)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        taskType,
        JSON.stringify(inputData),
        JSON.stringify(modelResponses.groq || null),
        JSON.stringify(modelResponses.gemini || null),
        JSON.stringify(modelResponses.deepseek || null),
        JSON.stringify(modelResponses.mistral || null),
        consensusReached,
        JSON.stringify(consensusReached ? { approved: true, confidence: (agreements/total)*100 } : null),
        JSON.stringify(!consensusReached ? { agreements, total, responses } : null)
      ]
    );

    return { consensusReached, agreements, total, confidence: (agreements/total)*100 };
  }

  // قرار الحوكمة
  async decide(decisionType, initiator, agentsConsulted, votesFor, votesAgainst, reasoning) {
    const total = votesFor + votesAgainst;
    let finalDecision;
    
    if (votesFor / total >= 0.66) finalDecision = 'approved';
    else if (votesAgainst / total >= 0.66) finalDecision = 'rejected';
    else finalDecision = 'escalated';

    const { rows } = await pool.query(
      `INSERT INTO governance_decisions 
       (decision_type, initiated_by, agents_consulted, votes_for, votes_against, final_decision, reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [decisionType, initiator, agentsConsulted, votesFor, votesAgainst, finalDecision, reasoning]
    );

    return { id: rows[0].id, finalDecision, votesFor, votesAgainst };
  }

  // فلترة البيانات — الطبقة الأولى
  async filterRaw(candidateId, agentName, score, passed, reason = null) {
    if (passed) {
      await pool.query(
        `UPDATE learning_candidates 
         SET filter_status='approved', filter_score=$1 WHERE id=$2`,
        [score, candidateId]
      );
    } else {
      await pool.query(
        `UPDATE learning_candidates 
         SET filter_status='rejected' WHERE id=$1`,
        [candidateId]
      );
      await pool.query(
        `INSERT INTO learning_rejected (candidate_id, rejected_by, rejection_reason, rejection_category)
         VALUES ($1,$2,$3,$4)`,
        [candidateId, agentName, reason || 'Failed filter', 'low_confidence']
      );
    }
    return { candidateId, passed, score };
  }

  // موافقة نهائية للتعلم
  async approveLearning(candidateId, verifiedByAgents, confidence, knowledge) {
    const { rows } = await pool.query(
      `INSERT INTO learning_approved 
       (candidate_id, verified_by_agents, final_confidence, knowledge_extracted)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [candidateId, verifiedByAgents, confidence, JSON.stringify(knowledge)]
    );
    return { approvedId: rows[0].id };
  }

  // إحصاءات الحوكمة
  async stats() {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total_decisions,
        COUNT(*) FILTER (WHERE final_decision='approved') as approved,
        COUNT(*) FILTER (WHERE final_decision='rejected') as rejected,
        COUNT(*) FILTER (WHERE final_decision='escalated') as escalated
      FROM governance_decisions
    `);
    return rows[0];
  }
}

export const governor = new GovernanceLayer();
export default governor;
