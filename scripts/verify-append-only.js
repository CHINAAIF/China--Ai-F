#!/usr/bin/env node

/**
 * Governance Health Verification System
 * Phase 1.5 - Self-Verification & Monitoring Layer
 * 
 * Features:
 * - Checks if RULES still exist
 * - Tests append-only protection
 * - Logs results to governance_health_checks table
 * - Detects any tampering or rule removal
 */

import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const protectedTables = [
  'evidence_chain',
  'immune_audit_chain',
  'intel_provenance_chain',
  'provenance_log',
  'governance_contracts',
  'routing_decisions',
  'judicial_routing_log',
  'schema_change_log'
];

async function checkRulesExist(tableName) {
  const result = await pool.query(`
    SELECT rulename FROM pg_rules 
    WHERE schemaname = 'public' 
      AND tablename = $1 
      AND rulename IN ($2, $3)
  `, [tableName, `${tableName}_no_update`, `${tableName}_no_delete`]);

  return result.rows.length === 2;
}

async function verifyAppendOnly() {
  console.log('=== GOVERNANCE HEALTH VERIFICATION (Phase 1.5) ===\n');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  let passed = 0;
  let failed = 0;

  for (const table of protectedTables) {
    let rulesExist = false;
    let updateBlocked = false;
    let deleteBlocked = false;
    let status = 'FAIL';
    let notes = '';

    try {
      // 1. Check if RULES still exist
      rulesExist = await checkRulesExist(table);

      // 2. Test UPDATE
      try {
        await pool.query(`UPDATE ${table} SET id = id WHERE id = -999999999;`);
        updateBlocked = false;
      } catch (e) {
        updateBlocked = true;
      }

      // 3. Test DELETE
      try {
        await pool.query(`DELETE FROM ${table} WHERE id = -999999999;`);
        deleteBlocked = false;
      } catch (e) {
        deleteBlocked = true;
      }

      // 4. Determine status
      if (rulesExist && updateBlocked && deleteBlocked) {
        status = 'PASS';
        passed++;
      } else {
        status = 'FAIL';
        failed++;
        if (!rulesExist) notes = 'Rules missing';
        else if (!updateBlocked || !deleteBlocked) notes = 'Protection incomplete';
      }

    } catch (err) {
      status = 'ERROR';
      failed++;
      notes = err.message;
    }

    // Log to database
    try {
      await pool.query(`
        INSERT INTO governance_health_checks 
        (table_name, update_blocked, delete_blocked, status, rules_present, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [table, updateBlocked, deleteBlocked, status, rulesExist, notes]);
    } catch (logErr) {
      console.error(`Failed to log result for ${table}:`, logErr.message);
    }

    const rulesIcon = rulesExist ? '✅' : '❌';
    const updateIcon = updateBlocked ? '✅' : '❌';
    const deleteIcon = deleteBlocked ? '✅' : '❌';

    console.log(
      `${table.padEnd(28)} | Rules:${rulesIcon} | UPDATE:${updateIcon} | DELETE:${deleteIcon} | ${status}`
    );
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed}/${protectedTables.length}`);
  console.log(`Failed: ${failed}/${protectedTables.length}`);

  if (failed === 0) {
    console.log('\n✅ All governance tables are healthy and protected.');
  } else {
    console.log('\n⚠️  Some tables have protection issues. Check governance_health_checks table.');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

verifyAppendOnly().catch(err => {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
