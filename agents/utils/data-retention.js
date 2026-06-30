import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';

const RETENTION = {
  agent_execution_logs:  '30 days',
  judicial_routing_log:  '14 days',
  security_filter_log:   '60 days',  // أمني — نحتفظ أطول
  circuit_breaker_log:   '14 days',
  webhook_queue:         '7 days',
  cost_tracking:         '90 days',  // مالي — نحتفظ أطول
  diagnostic_repairs:    '30 days',
};

export async function runRetention() {
  const results = {};

  for (const [table, interval] of Object.entries(RETENTION)) {
    try {
      // فحص الجدول أولاً
      const { rows: exists } = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name=$1
      `, [table]);

      if (exists.length === 0) { results[table] = 'not_found'; continue; }

      const { rowCount } = await pool.query(`
        DELETE FROM ${table}
        WHERE created_at < NOW() - INTERVAL '${interval}'
      `);

      results[table] = `deleted_${rowCount}`;
      if (rowCount > 0) console.log(`🗑️  ${table}: deleted ${rowCount} old rows`);

    } catch(e) {
      results[table] = `error:${e.message}`;
      console.warn(`⚠️  retention failed [${table}]: ${e.message}`);
    }
  }

  // تسجيل في diagnostic
  try {
    await pool.query(`
      INSERT INTO diagnostic_repairs
        (component, issue_type, description, auto_repaired, created_at)
      VALUES ('data-retention','scheduled_cleanup',$1,true,NOW())
    `, [JSON.stringify(results)]);
  } catch(_) {}

  console.log('✅ Data retention complete:', results);
  return results;
}

// ── VACUUM تحليلي بعد الحذف الكبير ──────────────────────────────
export async function analyzeTablesAfterCleanup() {
  const tables = Object.keys(RETENTION);
  for (const table of tables) {
    try {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('اسم جدول غير صالح: ' + table);
      await pool.query(`ANALYZE ${table}`);
    } catch(_) {}
  }
}

export default { runRetention, analyzeTablesAfterCleanup };
