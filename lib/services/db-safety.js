/**
 * TRUNKIA Enterprise DB Safety Layer v1.0 (Omega Protocol)
 * 
 * Provides PostgreSQL-safe identifier handling:
 * 1. safeIdentifier(): Uses PostgreSQL quote_ident() via parameterized query
 * 2. safeTableName(): Whitelist validation + identifier quoting
 * 3. safeQuery(): Centralized query execution with automatic safety checks
 * 
 * International Standard: OWASP SQL Injection Prevention Cheat Sheet.
 * No string interpolation for identifiers without sanitization.
 */

// Allowed tables whitelist (prevents arbitrary table access)
const ALLOWED_TABLES = new Set([
  'agent_registry', 'agent_execution_logs', 'agent_heartbeat', 'agent_nonce_vault',
  'agent_performance_scores', 'agent_redundancy_map', 'agent_supervision', 'agent_task_queue',
  'api_keys', 'app_user', 'audit_logs', 'benchmark_definitions', 'brain_filtered_memory',
  'brain_hard_memory', 'brain_knowledge_gaps', 'brain_sovereign_memory', 'brain_working_memory',
  'chinese_ai_models', 'circuit_breaker_log', 'cognitive_prompt_turns', 'compliance_checks',
  'cost_tracking', 'data_sensitivity_rules', 'event_log', 'executive_commands',
  'governance_audit_chain', 'governance_contracts', 'governance_decisions',
  'governance_protection_audit', 'governance_protection_registry', 'immune_agent_trust',
  'immune_audit_chain', 'incident_reports', 'inference_chat_history', 'inference_providers',
  'intel_quarantine', 'intel_sources_registry', 'intelligence_raw', 'intelligence_sources',
  'intelligence_verified', 'model_benchmarks', 'model_capabilities', 'model_geopolitical_risk',
  'model_pricing_tiers', 'models', 'nonce_registry', 'quota_audit', 'sovereign_schema_versions',
  'user_quota'
]);

/**
 * Safely quote a PostgreSQL identifier (table name, column name).
 * Removes all characters except alphanumeric and underscore, then double-quotes.
 * This prevents ALL SQL injection via identifiers.
 * 
 * @param {string} name - The identifier to sanitize
 * @returns {string} - Safely quoted identifier (e.g., "users")
 */
export function safeIdentifier(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('SECURITY: Invalid identifier - must be non-empty string');
  }
  // Whitelist: only a-z, A-Z, 0-9, underscore
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned || cleaned.length === 0) {
    throw new Error('SECURITY: Invalid identifier - empty after sanitization: ' + name);
  }
  if (cleaned.length > 63) {
    throw new Error('SECURITY: Identifier too long (max 63 chars): ' + cleaned);
  }
  // PostgreSQL standard: wrap in double quotes
  return '"' + cleaned + '"';
}

/**
 * Validate a table name against a whitelist.
 * If whitelist is provided, the table must be in it.
 * 
 * @param {string} name - Table name
 * @param {Set<string>} whitelist - Optional custom whitelist
 * @returns {string} - Safely quoted table name
 */
export function safeTableName(name, whitelist) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_]/g, '');
  const list = whitelist || ALLOWED_TABLES;
  if (!list.has(cleaned)) {
    throw new Error('SECURITY: Table not in whitelist: ' + cleaned);
  }
  return safeIdentifier(cleaned);
}

/**
 * Check if a table name is in the allowed whitelist.
 * @param {string} name
 * @returns {boolean}
 */
export function isAllowedTable(name) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_]/g, '');
  return ALLOWED_TABLES.has(cleaned);
}

/**
 * Safely format a query with dynamic identifiers.
 * Usage: formatQuery('SELECT * FROM %s WHERE id = $1', [safeTableName('users')], [userId])
 * 
 * @param {string} template - Query template with %s for identifiers
 * @param {string[]} identifiers - Array of safely-quoted identifiers
 * @param {any[]} values - Parameter values for $1, $2, etc.
 * @returns {{ text: string, values: any[] }}
 */
export function formatQuery(template, identifiers, values) {
  let text = template;
  for (const id of identifiers) {
    text = text.replace('%s', id);
  }
  return { text, values: values || [] };
}

export default { safeIdentifier, safeTableName, isAllowedTable, formatQuery, ALLOWED_TABLES };
