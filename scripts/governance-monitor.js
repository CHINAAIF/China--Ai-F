#!/usr/bin/env node

/**
 * Trinkia Governance Monitor v3.6
 * Source of truth: Actual RULES in database (not registry status)
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

async function getProtectedTablesCount() {
  const result = await pool.query(`
    SELECT COUNT(*) as total 
    FROM (
      SELECT tablename 
      FROM pg_rules 
      WHERE schemaname = 'public' 
        AND (rulename LIKE '%_no_update' OR rulename LIKE '%_no_delete')
      GROUP BY tablename
      HAVING COUNT(*) = 2
    ) t
  `);
  return parseInt(result.rows[0].total);
}

async function getRegisteredTables() {
  const result = await pool.query(`SELECT table_name FROM governance_protection_registry`);
  return result.rows.map(r => r.table_name);
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

async function registerNewTable(tableName) {
  const exists = await pool.query(
    `SELECT 1 FROM governance_protection_registry WHERE table_name = $1`,
    [tableName]
  );

  if (exists.rows.length === 0) {
    await pool.query(
      `INSERT INTO governance_protection_registry (table_name, priority_level, status) 
       VALUES ($1, 'medium', 'pending_review')`,
      [tableName]
    );
    return true;
  }
  return false;
}

async function runGovernanceMonitor() {
  console.log('=== TRINKIA GOVERNANCE MONITOR v3.6 ===\n');

  const protectedCount = await getProtectedTablesCount();
  const registeredTables = await getRegisteredTables();

  let tamperDetected = 0;
  let newlyRegistered = [];

  for (const tableName of registeredTables) {
    const rulesExist = await checkRulesExist(tableName);
    if (!rulesExist) {
      await logGovernanceEvent('rule_removed', tableName, { message: 'Protection missing' });
      tamperDetected++;
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

  const newSensitive = await pool.query(discoveryQuery);

  for (const row of newSensitive.rows) {
    const wasRegistered = await registerNewTable(row.table_name);
    if (wasRegistered) {
      await logGovernanceEvent('new_sensitive_table', row.table_name, { message: 'Auto-registered' });
      newlyRegistered.push(row.table_name);
    }
  }

  const healthScore = protectedCount >= registeredTables.length ? 100 : 
                      Math.round((protectedCount / registeredTables.length) * 100);

  console.log(`Protected Tables (RULES) : ${protectedCount}`);
  console.log(`Registered Sensitive     : ${registeredTables.length}`);
  console.log(`Tamper Events            : ${tamperDetected}`);
  console.log(`New Tables Registered    : ${newlyRegistered.length}`);
  console.log(`Governance Health Score  : ${healthScore}/100\n`);

  if (tamperDetected > 0 || newlyRegistered.length > 0) {
    console.log('⚠️  Action Required');
  } else {
    console.log('✅ System Status: Healthy');
  }

  await logGovernanceEvent('daily_health_report', 'system', {
    protected: protectedCount,
    registered: registeredTables.length,
    tamper: tamperDetected,
    new_registered: newlyRegistered.length,
    health_score: healthScore
  });
}

runGovernanceMonitor()
  .catch(err => console.error('FATAL ERROR:', err.message))
  .finally(async () => await pool.end());
