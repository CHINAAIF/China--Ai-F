import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import './config/env.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// الجداول التي لا تقبل أي تحديث أو حذف (Append-Only)
const PURE_APPEND_ONLY = [
  'evidence_chain', 'immune_audit_chain', 'intel_provenance_chain',
  'provenance_log', 'routing_decisions', 'judicial_routing_log', 
  'schema_change_log', 'security_events', 'security_incidents', 
  'audit_logs', 'byok_keys', 'canary_tokens', 'sovereign_key_infrastructure', 
  'governance_audit_chain', 'canary_infrastructure', 'canary_token_registry', 
  'canary_trigger_events', 'canary_trigger_forensics', 'crawler_threat_pipeline'
];

// الجداول التي لها دورة حياة (تقبل تحديث خاضع لـ Trigger، وتمنع الحذف عبر Rule)
const LIFECYCLE_TABLES = [
  'intel_quarantine', 'ai_agent_logs', 'immune_agent_trust',
  'intel_sources_registry', 'intelligence_raw', 'intelligence_verified',
  'policy_documents', 'governance_contracts'
];

describe('TRUNKIA Governance Protection Registry', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should protect PURE_APPEND_ONLY tables with both _no_update and _no_delete rules', async () => {
    for (const table of PURE_APPEND_ONLY) {
      const res = await pool.query(`
        SELECT COUNT(*) as count FROM pg_rules
        WHERE schemaname = 'public' AND tablename = $1
        AND rulename IN ($2, $3)
      `, [table, `${table}_no_update`, `${table}_no_delete`]);
      
      expect(parseInt(res.rows[0].count), `Table ${table} should have 2 rules`).toBe(2);
    }
  });

  it('should protect LIFECYCLE_TABLES with a TRIGGER and a _no_delete rule', async () => {
    for (const table of LIFECYCLE_TABLES) {
      const triggers = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.triggers
        WHERE event_object_schema = 'public' AND event_object_table = $1
        AND (trigger_name LIKE 'trg_prevent_%' OR trigger_name LIKE '%_lifecycle_trigger')
      `, [table]);
      expect(parseInt(triggers.rows[0].count), `Table ${table} should have a lifecycle/protection trigger`).toBeGreaterThan(0);

      const rules = await pool.query(`
        SELECT COUNT(*) as count FROM pg_rules
        WHERE schemaname = 'public' AND tablename = $1
        AND rulename = $2
      `, [table, `${table}_no_delete`]);
      expect(parseInt(rules.rows[0].count), `Table ${table} should have a _no_delete rule`).toBe(1);
    }
  });

  it('should ensure NO table has a _no_update RULE simultaneously with a lifecycle TRIGGER', async () => {
    // هذا الاختبار يطبق قرار ADR-001 برمجياً لمنع كوارث كتم التحديثات الشرعية
    const allTables = [...PURE_APPEND_ONLY, ...LIFECYCLE_TABLES];
    
    for (const table of allTables) {
      const updateRule = await pool.query(`
        SELECT COUNT(*) as count FROM pg_rules
        WHERE schemaname = 'public' AND tablename = $1 AND rulename = $2
      `, [table, `${table}_no_update`]);
      
      const triggers = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.triggers
        WHERE event_object_schema = 'public' AND event_object_table = $1
        AND (trigger_name LIKE 'trg_prevent_%' OR trigger_name LIKE '%_lifecycle_trigger')
      `, [table]);
      
      const hasUpdateRule = parseInt(updateRule.rows[0].count) > 0;
      const hasTriggers = parseInt(triggers.rows[0].count) > 0;
      
      expect(hasUpdateRule && hasTriggers, `FATAL: Table ${table} has BOTH _no_update RULE and a TRIGGER!`).toBe(false);
    }
  });
});
