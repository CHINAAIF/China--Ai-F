import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import '../config/env.js';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: true });

describe('Database Immutability Protections (Integration)', () => {
  
  // Test 1: Verify revocation of DML privileges on append-only tables via Catalog
  it('should verify app_user lacks UPDATE and DELETE on audit_logs', async () => {
    const res = await pool.query(`
      SELECT privilege_type 
      FROM information_schema.role_table_grants 
      WHERE table_name = 'audit_logs' AND grantee = 'app_user' AND privilege_type IN ('DELETE', 'UPDATE')
    `);
    // If 0 rows, it means app_user has NO UPDATE or DELETE privileges
    expect(res.rows.length).toBe(0);
    console.log('[PASS] app_user correctly lacks UPDATE/DELETE privileges on audit_logs (Catalog verified).');
  });

  // Test 2: Verify RULE protection exists on audit_logs via Catalog
  it('should verify absolute protection RULEs exist on audit_logs', async () => {
    const res = await pool.query(`
      SELECT rulename 
      FROM pg_rules 
      WHERE tablename = 'audit_logs' AND rulename IN ('audit_logs_no_update', 'audit_logs_no_delete')
    `);
    // If 2 rows, both protection rules exist
    expect(res.rows.length).toBe(2);
    console.log('[PASS] Absolute RULEs (no_update, no_delete) are actively protecting audit_logs (Catalog verified).');
  });

  // Test 3: Smart TRIGGER Protection (Lifecycle Tables) - Triggers throw exceptions, so DML test is valid here
  it('should block tampering attempts on TRIGGER-protected tables (governance_contracts)', async () => {
    const client = await pool.connect();
    try {
      const insertRes = await client.query(
        "INSERT INTO governance_contracts (nonce, content_hash, signature, valid_until, used) VALUES (crypto.randomUUID(), 'hash', 'sig', NOW() + INTERVAL '1 hour', false) RETURNING id;"
      );
      const contractId = insertRes.rows[0].id;

      await expect(
        client.query("UPDATE governance_contracts SET used=true, used_at=NOW(), nonce='tampered' WHERE id=$1;", [contractId])
      ).rejects.toThrow(/Tampering detected|Invalid contract lifecycle/);
      
      console.log('[PASS] TRIGGER successfully blocked tampering on governance_contracts.');
    } finally {
      client.release();
    }
  }, 10000);

});
