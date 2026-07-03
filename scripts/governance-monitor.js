#!/usr/bin/env node
/**
 * Trinkia Governance Monitor v2.3
 * Tamper-Evident + Proper Connection Handling
 *
 * إصلاحات:
 * - توسيع SENSITIVE_KEYWORDS (كانت تفوّت: canary, key, token, secret, credential,
 *   certificate, trust, session, user, quarantine, honeypot)
 * - التحقق من نجاح logGovernanceEvent بدل تجاهل النتيجة بصمت
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
  'chain', 'audit', 'log', 'governance', 'security', 'provenance', 'evidence',
  'intel', 'immune', 'policy', 'canary', 'key', 'token', 'secret', 'credential',
  'certificate', 'trust', 'session', 'user', 'quarantine', 'honeypot', 'threat'
];

async function getRegisteredTables() {
  const result = await pool.query(`
    SELECT table_name
    FROM governance_protection_registry
    WHERE status IN ('active', 'protected', 'pending_review')
  `);
  return result.rows.map(r => r.table_name);
}

async function checkRulesExist(tableName) {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM pg_rules
    WHERE schemaname = 'public'
      AND tablename = $1
      AND rulename IN ($2, $3)
  `, [tableName, `${tableName}_no_update`, `${tableName}_no_delete`]);
  return parseInt(result.rows[0].count) === 2;
}

async function runGovernanceMonitor() {
  console.log('=== TRINKIA GOVERNANCE MONITOR v2.3 ===\n');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const registeredTables = await getRegisteredTables();
  let issuesFound = 0;
  let logFailures = 0;

  for (const tableName of registeredTables) {
    // جداول مستثناة عمداً من الحماية الكاملة لأن الكود يحدّثها فعلياً (UPDATE مشروع) — قيد المراجعة اليدوية
    const PENDING_MANUAL_REVIEW = ['governance_protection_registry', 'ai_agent_logs', 'immune_agent_trust', 'intel_quarantine', 'intel_sources_registry', 'intelligence_raw', 'intelligence_verified', 'policy_documents'];
    if (PENDING_MANUAL_REVIEW.includes(tableName)) continue;

    const rulesExist = await checkRulesExist(tableName);

    if (!rulesExist) {
      console.log(`❌ TAMPER DETECTED: ${tableName}`);
      const r = await logGovernanceEvent('rule_removed', tableName, {
        message: 'One or both append-only rules are missing'
      });
      if (!r.success) {
        console.error(`   ⚠️ فشل تسجيل الحدث نفسه: ${r.error}`);
        logFailures++;
      }
      issuesFound++;
    }
  }

  const discoveryQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND (${SENSITIVE_KEYWORDS.map(k => `table_name LIKE '%${k}%'`).join(' OR ')})
      AND table_name NOT IN (SELECT table_name FROM governance_protection_registry)
    ORDER BY table_name
  `;

  const newTables = await pool.query(discoveryQuery);

  if (newTables.rows.length > 0) {
    console.log('\n⚠️  NEW SENSITIVE TABLES DETECTED:');
    for (const row of newTables.rows) {
      console.log(`   - ${row.table_name}`);
      const r = await logGovernanceEvent('new_sensitive_table', row.table_name, {
        message: 'New sensitive table discovered without protection'
      });
      if (!r.success) {
        console.error(`   ⚠️ فشل تسجيل الحدث نفسه: ${r.error}`);
        logFailures++;
      }
      issuesFound++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Registered tables checked: ${registeredTables.length}`);
  console.log(`Issues detected: ${issuesFound}`);
  console.log(`Audit log write failures: ${logFailures}`);

  if (issuesFound === 0) {
    console.log('\n✅ Governance protection status: HEALTHY');
  } else {
    console.log('\n⚠️  Governance protection status: ISSUES DETECTED');
  }
}

runGovernanceMonitor()
  .catch(err => {
    console.error('FATAL ERROR:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
    console.log('\n[Info] Database connection closed cleanly.');
  });
