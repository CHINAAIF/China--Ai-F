import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';

const THRESHOLDS = {
  dead_agents:    5,
  failed_tasks:  20,
  error_rate:    0.4,   // 40% فشل خلال ساعة
};

export async function checkAndAlert() {
  const alerts = [];

  try {
    // فحص 1: failed tasks آخر ساعة
    const { rows: f } = await pool.query(`
      SELECT COUNT(*) as cnt FROM agent_execution_logs
      WHERE status='failed' AND created_at > NOW() - INTERVAL '1 hour'
    `);
    const failed = parseInt(f[0].cnt);
    if (failed > THRESHOLDS.failed_tasks) {
      alerts.push({ type: 'high_failure', value: failed, threshold: THRESHOLDS.failed_tasks });
    }

    // فحص 2: نسبة الفشل
    const { rows: t } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='failed')  as fails,
        COUNT(*)                                  as total
      FROM agent_execution_logs
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);
    const rate = t[0].total > 0 ? t[0].fails / t[0].total : 0;
    if (rate > THRESHOLDS.error_rate && t[0].total > 10) {
      alerts.push({ type: 'high_error_rate', value: rate.toFixed(2), threshold: THRESHOLDS.error_rate });
    }

    // فحص 3: وكلاء لم تُسجَّل لهم أي عملية منذ ساعتين
    const { rows: d } = await pool.query(`
      SELECT agent_name, MAX(created_at) as last_seen
      FROM agent_execution_logs
      GROUP BY agent_name
      HAVING MAX(created_at) < NOW() - INTERVAL '2 hours'
    `);
    if (d.length > THRESHOLDS.dead_agents) {
      alerts.push({ type: 'dead_agents', value: d.length, agents: d.map(r=>r.agent_name) });
    }

    // تسجيل كل alert في diagnostic_repairs
    for (const alert of alerts) {
      await pool.query(`
        INSERT INTO diagnostic_repairs
          (component, issue_type, description, auto_repaired, created_at)
        VALUES ($1,$2,$3,$4,NOW())
      `, [
        'alert-engine',
        alert.type,
        JSON.stringify(alert),
        false
      ]).catch(()=>{});

      console.error(`🚨 ALERT [${alert.type}]: ${JSON.stringify(alert)}`);
    }

  } catch(e) {
    console.warn('alert-engine error:', e.message);
  }

  return alerts;
}

export async function recordRepair(component, description) {
  try {
    await pool.query(`
      INSERT INTO diagnostic_repairs
        (component, issue_type, description, auto_repaired, created_at)
      VALUES ($1,'auto_repair',$2,true,NOW())
    `, [component, description]);
  } catch(_) {}
}

export default { checkAndAlert, recordRepair };
