import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function diag() {
  var checks = [
    ['model_pricing_tiers', 'model_capabilities', 'model_accuracy_registry', 'model_benchmarks', 'prompts', 'articles', 'courses', 'models', 'model_reviews', 'model_view_stats'],
    ['brain_working_memory', 'brain_filtered_memory', 'brain_hard_memory', 'brain_sovereign_memory', 'brain_long_memory'],
    ['learning_candidates', 'learning_approved', 'learning_rejected', 'knowledge_conflicts', 'knowledge_distillation'],
    ['model_consensus', 'prediction_registry', 'benchmark_definitions', 'cost_tracking'],
    ['subscription_plans', 'billing_events', 'user_subscriptions', 'users', 'user_profiles', 'api_keys'],
    ['compliance_checks', 'privacy_scores', 'incident_reports', 'data_sensitivity_rules'],
    ['webhook_queue', 'agent_execution_logs', 'agent_performance_scores', 'agent_supervision', 'agent_redundancy_map'],
    ['agent_registry', 'agent_heartbeat', 'agent_task_queue', 'agent_circuit_breaker', 'agent_dependencies', 'agent_errors'],
    ['system_health', 'system_settings', 'feature_flags', 'event_log', 'governance_contracts', 'nonce_registry', 'routing_decisions', 'byok_keys', 'evidence_chain', 'security_filter_log', 'judicial_routing_log', 'sovereign_memory_local', 'sovereign_operations']
  ];
  for (var group of checks) {
    var qs = checks.map(function(t) { return pool.query('SELECT count(*) as c FROM ' + t); });
    var results = await Promise.all(qs);
    var row = {};
    for (var i = 0; i < checks.length; i++) row[checks[i]] = results[i].rows[0].c;
    var nonZero = results.filter(function(r) { return r.rows[0].c > 0; });
    if (nonZero.length > 0) {
      console.log(group[0].replace('_', ' | ') + ': ' + nonZero.map(function(r,i) { return checks[i] + ':' + r.rows[0].c; }).join(' | '));
    }
  }
  // Count total
  var all = await pool.query("SELECT count(*) as c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  console.log('\nTotal tables: ' + all.rows[0].c);
  await pool.end();
}
diag().catch(function(e) { console.error('ERR: ' + e.message); });
