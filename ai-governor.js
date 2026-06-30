import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

export async function checkPermission(role, resource, action) {
  const result = await pool.query(
    'SELECT allowed FROM ai_permissions WHERE role=$1 AND resource=$2 AND action=$3',
    [role, resource, action]
  );
  return result.rows[0]?.allowed ?? false;
}

export async function agentExecute({ agentId, userId, action, resource, input, executeFn }) {
  const allowed = await checkPermission('ai_agent', resource, action);
  
  await pool.query(
    `INSERT INTO ai_agent_logs (agent_id, user_id, action, permission_level, input, approved)
     VALUES ($1, $2, $3, 'ai_agent', $4, $5)`,
    [agentId, userId, action, JSON.stringify(input), allowed]
  );

  if (!allowed) {
    return { success: false, error: 'PERMISSION_DENIED', action, resource };
  }

  const output = await executeFn();
  
  await pool.query(
    `UPDATE ai_agent_logs SET output=$1 WHERE agent_id=$2 AND action=$3 
     AND created_at=(SELECT MAX(created_at) FROM ai_agent_logs WHERE agent_id=$2)`,
    [JSON.stringify(output), agentId, action]
  );

  return { success: true, output };
}
