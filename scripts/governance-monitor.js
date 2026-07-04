#!/usr/bin/env node

/**
 * Trinkia Governance Monitor v3.0
 * Professional Tamper-Evident Monitoring System
 * 
 * Features:
 * - Multi-dimensional sensitive table detection
 * - Automatic logging to governance_audit_chain
 * - Governance Health Score calculation
 * - Tamper detection with severity levels
 * - Production-ready error handling
 */

import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
import { logGovernanceEvent } from '../lib/governance-audit-chain.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SENSITIVE_KEYWORDS = [
  'chain', 'audit', 'log', 'governance', 'security', 
  'provenance', 'evidence', 'intel', 'immune', 'policy',
  'threat', 'zero_trust', 'canary', 'byok', 'sovereign_key'
];

async function getProtectedTables() {
  const result = await pool.query(`
    SELECT tablename 
    FROM pg_rules 
    WHERE schemaname = 'public' 
      AND (rulename LIKE '%_no_update' OR rulename LIKE '%_no_delete')
    GROUP BY tablename
    HAVING COUNT(*) = 2
  `);
  return result.rows.map(r => r.tablename);
}

async function getRegisteredTables() {
  const result = await pool.query(`
    SELECT table_name, priority_level, status 
    FROM governance_protection_registry
  `);
  return result.rows;
}

async function checkRulesExist(tableName) {
  const result = await pool.query(`
    SELECT COUNT(*) as count 
    FROM pg_rules 
    WHERE schemaname = 'public' 
      AND tablename = $1 
      AND rulename IN ($2, $3)
  `, [tableName, `${tableName}_no_update`, `${tableName}_no_delete`]);

  return parseInt(result.rows[0].count) === 2;
}

async function calculateHealthScore(protectedCount, totalSensitive) {
  if (totalSensitive === 0) return 100;
  const coverage = (protectedCount / totalSensitive) * 100;
  return Math.round(Math.min(coverage, 100));
}

async function runGovernanceMonitor() {
  console.log('=== TRINKIA GOVERNANCE MONITOR v3.0 ===\n');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const protectedTables = await getProtectedTables();
  const registeredTables = await getRegisteredTables();

  let tamperDetected = 0;
  let newTablesDetected = 0;

  // التحقق من الجداول المسجلة
  for (const row of registeredTables) {
    const tableName = row.table_name;
    const rulesExist = await checkRulesExist(tableName);

    if (!rulesExist) {
      await logGovernanceEvent(
        'rule_removed',
        tableName,
        { 
          severity: row.priority_level || 'high',
          message: 'Append-only protection is missing',
          detected_at: new Date().toISOString()
        }
      );
      tamperDetected++;
    }
  }

  // اكتشاف جداول حساسة جديدة
  const discoveryQuery = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND (${SENSITIVE_KEYWORDS.map(k => `table_name LIKE '%${k}%'`).join(' OR ')})
      AND table_name NOT IN (SELECT table_name FROM governance_protection_registry)
    ORDER BY table_name
  `;

  const newSensitive = await pool.query(discoveryQuery);

  for (const row of newSensitive.rows) {
    await logGovernanceEvent(
      'new_sensitive_table',
      row.table_name,
      { 
        message: 'New sensitive table discovered without protection',
        detected_at: new Date().toISOString()
      }
    );
    newTablesDetected++;
  }

  // حساب درجة الصحة
  const healthScore = calculateHealthScore(protectedTables.length, registeredTables.length);

  console.log(`Protected Tables       : ${protectedTables.length}`);
  console.log(`Registered Sensitive   : ${registeredTables.length}`);
  console.log(`Tamper Events Detected : ${tamperDetected}`);
  console.log(`New Sensitive Tables   : ${newTablesDetected}`);
  console.log(`Governance Health Score: ${healthScore}/100\n`);

  if (tamperDetected > 0 || newTablesDetected > 0) {
    console.log('⚠️  Action Required: Review governance_protection_audit');
  } else {
    console.log('✅ System Status: Healthy');
  }

  // تسجيل التقرير اليومي في السلسلة
  await logGovernanceEvent(
    'daily_health_report',
    'system',
    {
      protected_tables: protectedTables.length,
      registered_sensitive: registeredTables.length,
      tamper_events: tamperDetected,
      new_sensitive: newTablesDetected,
      health_score: healthScore
    }
  );
}

runGovernanceMonitor()
  .catch(err => console.error('FATAL ERROR:', err.message))
  .finally(async () => {
    await pool.end();
  });
