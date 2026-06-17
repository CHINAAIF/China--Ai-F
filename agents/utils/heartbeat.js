import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

export async function pingHeartbeat(agentName, status = 'active', metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO agent_heartbeat (agent_name, status, last_ping, missed_pings, metadata)
       VALUES ($1,$2,now(),0,$3)
       ON CONFLICT (agent_name) DO UPDATE SET
         status=$2, last_ping=now(), missed_pings=0, metadata=$3`,
      [agentName, status, JSON.stringify(metadata)]
    );
  } catch(e) { console.warn(`⚠️ heartbeat_fail ${agentName}: ${e.message}`); }
}

export async function markMissed() {
  try {
    await pool.query(
      `UPDATE agent_heartbeat SET missed_pings=missed_pings+1, status='warning'
       WHERE last_ping < now()-interval'3 minutes' AND status='active'`
    );
    await pool.query(
      `UPDATE agent_heartbeat SET status='dead'
       WHERE missed_pings>5 AND status='warning'`
    );
  } catch(e) { console.warn('⚠️ markMissed:', e.message); }
}

export async function getSystemHealth() {
  try {
    const [total, dead, warning, active] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM agent_heartbeat`),
      pool.query(`SELECT COUNT(*) FROM agent_heartbeat WHERE status='dead'`),
      pool.query(`SELECT COUNT(*) FROM agent_heartbeat WHERE status='warning'`),
      pool.query(`SELECT COUNT(*) FROM agent_heartbeat WHERE status='active'`),
    ]);
    return {
      total: parseInt(total.rows[0].count),
      active: parseInt(active.rows[0].count),
      warning: parseInt(warning.rows[0].count),
      dead: parseInt(dead.rows[0].count),
    };
  } catch(e) { return { error: e.message }; }
}
