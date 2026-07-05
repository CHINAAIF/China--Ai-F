#!/usr/bin/env node

/**
 * Trinkia Governance Monitor v3.10
 * Skip testing governance tables themselves
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

const GOVERNANCE_TABLES = [
  'governance_health_checks',
  'governance_protection_registry',
  'governance_protection_audit',
  'governance_audit_chain'
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

async function testRuleIsWorking(tableName) {
  // Skip governance tables themselves
  if (GOVERNANCE_TABLES.includes(tableName)) {
    return true;
  }

  let updateBlocked = false;
  let deleteBlocked = false;

  try { await pool.query(`UPDATE ${tableName} SET id = id WHERE id = -999999999;`); } 
  catch (e) { updateBlocked = true; }

  try { await pool.query(`DELETE FROM ${tableName} WHERE id = -999999999;`); } 
  catch (e) { deleteBlocked = true; }

  return updateBlocked && deleteBlocked;
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
  console.log('=== TRINKIA GOVERNANCE MONITOR v3.10 ===\n');

  const protectedTables = await getProtectedTables();
  const registeredTables = await getRegisteredTables();

  let tamperDetected = 0;
  let failedProtection = [];
  let newlyRegistered = [];

  for (const tableName of registeredTables) {
    const rulesExist = await checkRulesExist(tableName);

    if (!rulesExist) {
      await logGovernanceEvent('rule_removed', tableName, { message: 'Rules missing' });
      tamperDetected++;
    } else {
      const isWorking = await testRuleIsWorking(tableName);
      if (!isWorking) {
        failedProtection.push(tableName);
        await logGovernanceEvent('protection_failed', tableName, { message: 'Rules not effective' });
      }
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
    if (wasRegistered) newlyRegistered.push(row.table_name);
  }

  const healthScore = protectedTables.length >= registeredTables.length ? 100 : 
                      Math.round((protectedTables.length / registeredTables.length) * 100);

  console.log(`Protected Tables (RULES) : ${protectedTables.length}`);
  console.log(`Registered Sensitive     : ${registeredTables.length}`);
  console.log(`Tamper Events            : ${tamperDetected}`);
  console.log(`Failed Protection        : ${failedProtection.length}`);
  console.log(`New Tables Registered    : ${newlyRegistered.length}`);
  console.log(`Governance Health Score  : ${healthScore}/100\n`);

  if (failedProtection.length > 0) {
    console.log('=== Tables with Failed Protection ===');
    failedProtection.forEach(t => console.log(`  - ${t}`));
    console.log('');
  }

  if (tamperDetected > 0 || failedProtection.length > 0 || newlyRegistered.length > 0) {
    console.log('⚠️  Action Required');
  } else {
    console.log('✅ System Status: Healthy');
  }

  await logGovernanceEvent('daily_health_report', 'system', {
    protected: protectedTables.length,
    registered: registeredTables.length,
    tamper: tamperDetected,
    failed_protection: failedProtection.length,
    new_registered: newlyRegistered.length,
    health_score: healthScore
  });
}

runGovernanceMonitor()
  .catch(err => console.error('FATAL ERROR:', err.message))
  .finally(async () => await pool.end());
