#!/usr/bin/env node

/**
 * Verify Append-Only Protection
 * Phase 1 - Governance & Evidence Chain Hardening
 * 
 * Usage:
 *   node scripts/verify-append-only.js
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

async function verifyAppendOnly() {
  console.log('=== APPEND-ONLY PROTECTION VERIFICATION ===\n');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Total tables to verify: ${protectedTables.length}\n`);

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const table of protectedTables) {
    let updateBlocked = false;
    let deleteBlocked = false;

    try {
      // Test UPDATE
      await pool.query(`UPDATE ${table} SET id = id WHERE id = -999999999;`);
      updateBlocked = false;
    } catch (e) {
      updateBlocked = true;
    }

    try {
      // Test DELETE
      await pool.query(`DELETE FROM ${table} WHERE id = -999999999;`);
      deleteBlocked = false;
    } catch (e) {
      deleteBlocked = true;
    }

    const status = (updateBlocked && deleteBlocked) ? 'PASS' : 'FAIL';
    if (status === 'PASS') passed++;
    else failed++;

    results.push({
      table,
      update_blocked: updateBlocked,
      delete_blocked: deleteBlocked,
      status
    });

    console.log(`${table.padEnd(28)} | UPDATE: ${updateBlocked ? '✅' : '❌'} | DELETE: ${deleteBlocked ? '✅' : '❌'} | ${status}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed}/${protectedTables.length}`);
  console.log(`Failed: ${failed}/${protectedTables.length}`);

  if (failed === 0) {
    console.log('\n✅ All tables are properly protected as append-only.');
  } else {
    console.log('\n❌ Some tables have incomplete protection.');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

verifyAppendOnly().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
