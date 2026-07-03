#!/usr/bin/env node
/**
 * Trinkia Governance Decision Engine v2.1
 * إصلاح: التخلي عن الاعتماد على عمود resolved القابل للتعديل
 * (غير قابل للتحديث فعلياً بعد تطبيق append-only RULES على هذا الجدول)
 * الحالة الآن تُشتق بالقراءة: جدول "محلول" إن وُجد له سجل لاحق event_type='resolved'
 */
import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const CLASSIFICATION_RULES = {
  Critical: { keywords: ['chain', 'evidence', 'immune_audit', 'governance_decision', 'security_incident', 'provenance'], priority: 'critical', action: 'IMMEDIATE PROTECTION - Apply append-only rules within 24 hours' },
  High: { keywords: ['security', 'audit', 'intel', 'policy', 'governance', 'threat', 'zero_trust'], priority: 'high', action: 'HIGH PRIORITY - Add to protection registry and apply rules within 72 hours' },
  Medium: { keywords: ['log', 'model', 'agent', 'prompt', 'intelligence', 'session'], priority: 'medium', action: 'MEDIUM PRIORITY - Schedule protection in next maintenance cycle' }
};

function classifyTable(tableName) {
  const lower = tableName.toLowerCase();
  for (const [level, rule] of Object.entries(CLASSIFICATION_RULES)) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { level, priority: rule.priority, recommended_action: rule.action, reason: `Matches ${level.toLowerCase()} governance criteria` };
    }
  }
  return { level: 'Medium', priority: 'medium', recommended_action: 'MEDIUM PRIORITY - Review and decide protection level', reason: 'General sensitive table requiring evaluation' };
}

async function runDecisionEngine() {
  console.log('=== TRINKIA GOVERNANCE DECISION ENGINE v2.1 (append-only state) ===\n');

  // إصلاح: بدل WHERE resolved=false، نشتق "غير المعالج" من عدم وجود سجل resolved لاحق لنفس الجدول
  const pendingTables = await pool.query(`
    SELECT DISTINCT n.table_name
    FROM governance_protection_audit n
    WHERE n.event_type = 'new_sensitive_table'
      AND NOT EXISTS (
        SELECT 1 FROM governance_protection_audit r
        WHERE r.table_name = n.table_name
          AND r.event_type = 'resolved'
          AND r.detected_at > n.detected_at
      )
    ORDER BY n.table_name
  `);

  if (pendingTables.rows.length === 0) {
    console.log('✅ No pending tables for classification.');
    await pool.end();
    return;
  }

  console.log(`Processing ${pendingTables.rows.length} tables...\n`);
  let critical = 0, high = 0, medium = 0;

  for (const row of pendingTables.rows) {
    const tableName = row.table_name;
    const classification = classifyTable(tableName);
    const details = {
      classification: classification.level, priority: classification.priority,
      reason: classification.reason, recommended_action: classification.recommended_action,
      engine_version: '2.1', mode: 'recommendation_only', generated_at: new Date().toISOString()
    };

    await pool.query(`
      INSERT INTO governance_protection_audit (table_name, event_type, severity, details)
      VALUES ($1, 'protection_recommendation', $2, $3)
    `, [tableName, classification.level.toLowerCase(), details]);

    // إصلاح: بدل UPDATE resolved=true (ممنوع الآن)، نضيف سجل resolved جديد يُشير أن هذا العنصر عولج
    await pool.query(`
      INSERT INTO governance_protection_audit (table_name, event_type, severity, details)
      VALUES ($1, 'resolved', $2, $3)
    `, [tableName, classification.level.toLowerCase(), { reason: 'Classified and recommendation logged', resolved_via: 'decision-engine-v2.1' }]);

    await pool.query(`
      INSERT INTO governance_protection_registry (table_name, priority_level, status, notes)
      VALUES ($1, $2, 'pending_review', $3)
      ON CONFLICT (table_name) DO UPDATE
      SET priority_level = $2, notes = $3, last_verified = NOW()
    `, [tableName, classification.priority, classification.recommended_action]);

    if (classification.level === 'Critical') critical++;
    else if (classification.level === 'High') high++;
    else medium++;

    console.log(`${tableName.padEnd(34)} → ${classification.level.padEnd(8)} | ${classification.priority}`);
  }

  console.log('\n=== CLASSIFICATION SUMMARY ===');
  console.log(`Critical : ${critical} | High : ${high} | Medium : ${medium} | Total : ${pendingTables.rows.length}`);
  console.log('\n✅ All recommendations logged (append-only, no UPDATE used).');
  await pool.end();
}

runDecisionEngine().catch(err => { console.error('FATAL ERROR:', err.message); process.exit(1); });
