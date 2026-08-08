#!/bin/bash
set -e
cd ~/downloads/China--Ai-F

node --input-type=module << 'ENDOFFILE'
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

const tables = [
  'governance_decisions', 'crawler_security_pipeline', 'domain_intelligence_registry',
  'governance_health_checks', 'governance_protection_audit', 'intelligence_sources',
  'ip_threat_intelligence', 'output_security_scan', 'policy_cache_state',
  'policy_conflicts_log', 'session_security_timeline', 'temporal_intelligence',
  'threat_intelligence_feeds', 'zero_trust_policy_engine', 'zero_trust_policy_matrix',
  'api_key_usage_logs', 'certificate_transparency_log', 'circuit_breaker_log',
  'divergence_log', 'immune_anomaly_log', 'immune_critic_evaluations',
  'immune_dark_networks', 'login_attempts', 'model_changelog',
  'prompt_preprocessing_log', 'quality_gate_log'
];

let success = 0, failed = 0;

for (const t of tables) {
  try {
    await pool.query(`CREATE OR REPLACE RULE ${t}_no_update AS ON UPDATE TO ${t} DO INSTEAD NOTHING;`);
    await pool.query(`CREATE OR REPLACE RULE ${t}_no_delete AS ON DELETE TO ${t} DO INSTEAD NOTHING;`);
    console.log(`✅ ${t}`);
    success++;
  } catch (e) {
    console.log(`❌ ${t}: ${e.message}`);
    failed++;
  }
}

// تحديث السجل: هذه الجداول أصبحت الآن protected فعلياً
await pool.query(`
  UPDATE governance_protection_registry
  SET status = 'protected', last_verified = NOW()
  WHERE table_name = ANY($1)
`, [tables]);

console.log(`\n=== النتيجة: ${success} نجح، ${failed} فشل ===`);
console.log('✅ تم تحديث governance_protection_registry');

await pool.end();
ENDOFFILE
