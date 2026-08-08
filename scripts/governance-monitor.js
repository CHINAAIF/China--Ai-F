#!/usr/bin/env node

/**
 * Trunkia Governance Monitor v4.1
 * Professional multi-layer protection verification with Webhook Alerting
 */

import '../config/env.js';
import pg from 'pg';
import { logGovernanceEvent } from '../lib/governance-audit-chain.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

// === Fixed Protection Categories ===
const RULE_BASED = [
  'evidence_chain', 'immune_audit_chain', 'intel_provenance_chain',
  'provenance_log', 'governance_contracts', 'routing_decisions',
  'judicial_routing_log', 'schema_change_log', 'security_events',
  'security_incidents', 'audit_logs', 'byok_keys', 'canary_tokens',
  'sovereign_key_infrastructure', 'governance_audit_chain',
  'canary_infrastructure', 'canary_token_registry', 'canary_trigger_events',
  'canary_trigger_forensics', 'crawler_threat_pipeline'
];

const TRIGGER_BASED = [
  'intel_quarantine',
  'ai_agent_logs',
  'immune_agent_trust',
  'intel_sources_registry',
  'intelligence_raw',
  'intelligence_verified',
  'policy_documents'
];

const SENSITIVE_KEYWORDS = [
  'chain', 'audit', 'log', 'governance', 'security',
  'provenance', 'evidence', 'intel', 'immune', 'policy',
  'threat', 'zero_trust', 'canary', 'byok', 'sovereign_key'
];

async function sendAlert(message) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[WARN] ALERT_WEBHOOK_URL is not set. Alerts will only be printed to stdout.');
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🚨 **Governance Alert**\n\`\`\`${message}\`\`\`` })
    });
  } catch (e) {
    console.error('[ERROR] Failed to send alert to webhook:', e.message);
  }
}

async function getRegisteredTables() {
  const result = await pool.query(`SELECT table_name FROM governance_protection_registry`);
  return result.rows.map(r => r.table_name);
}

async function checkRuleExists(tableName) {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM pg_rules
    WHERE schemaname = 'public'
      AND tablename = $1
      AND rulename IN ($2, $3)
  `, [tableName, `${tableName}_no_update`, `${tableName}_no_delete`]);
  return parseInt(result.rows[0].count) === 2;
}

async function checkTriggerExists(tableName) {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = $1
      AND (trigger_name LIKE 'trg_prevent_%' OR trigger_name LIKE '%_lifecycle_trigger')
  `, [tableName]);
  return parseInt(result.rows[0].count) > 0;
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
  console.log('=== TRUNKIA GOVERNANCE MONITOR v4.1 ===\n');

  const registeredTables = await getRegisteredTables();

  let tamperDetected = 0;
  let missingProtection = [];
  let newlyRegistered = 0;

  for (const tableName of registeredTables) {
    const hasRule = await checkRuleExists(tableName);
    const hasTrigger = await checkTriggerExists(tableName);

    if (!hasRule && !hasTrigger) {
      await logGovernanceEvent('rule_removed', tableName, { message: 'No protection found' });
      tamperDetected++;
      missingProtection.push(tableName);
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
    if (wasRegistered) newlyRegistered++;
  }

  const totalRegistered = registeredTables.length;
  const healthScore = totalRegistered > 0 ? Math.round(((totalRegistered - tamperDetected) / totalRegistered) * 100) : 0;

  console.log(`Registered Sensitive     : ${totalRegistered}`);
  console.log(`Tamper Events            : ${tamperDetected}`);
  console.log(`New Tables Registered    : ${newlyRegistered}`);
  console.log(`Governance Health Score  : ${healthScore}/100\n`);

  if (missingProtection.length > 0) {
    console.log('=== Tables Missing Protection ===');
    missingProtection.forEach(t => console.log(`  - ${t}`));
    console.log('');
  }

  if (tamperDetected > 0 || newlyRegistered > 0) {
    const alertMsg = `Action Required:\nTamper Events: ${tamperDetected}\nNew Tables: ${newlyRegistered}\nMissing: ${missingProtection.join(', ')}`;
    console.log('⚠️  Action Required');
    await sendAlert(alertMsg);
  } else {
    console.log('✅ System Status: Healthy');
  }

  await logGovernanceEvent('daily_health_report', 'system', {
    registered: totalRegistered,
    tamper: tamperDetected,
    new_registered: newlyRegistered,
    health_score: healthScore
  });
}

export { runGovernanceMonitor };

if (import.meta.url === `file://${process.argv[1]}`) {
  runGovernanceMonitor()
    .catch(err => console.error('FATAL ERROR:', err.message))
    .finally(async () => await pool.end());
}
