-- ==========================================================
-- TRUNKIA SOVEREIGN BOOTSTRAP SCRIPT v2.0 (Omega Protocol)
-- Generated: 2026-08-08T23:45:22.924Z
-- Run this in Neon SQL Editor as the Database Owner
-- Hierarchical Order: SCHEMA → TYPE → TABLE → INDEX → FUNCTION → TRIGGER → POLICY → GRANT
-- Total Statements: 235
-- ==========================================================

-- ==========================================================
-- LAYER: SCHEMA
-- ==========================================================
BEGIN;
-- Source: schema-part1.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Source: schema-part1.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Source: schema-part1.sql
CREATE EXTENSION IF NOT EXISTS "citext";

COMMIT;

-- ==========================================================
-- LAYER: TABLE
-- ==========================================================
BEGIN;
-- Source: schema-part1.sql
CREATE TABLE IF NOT EXISTS zero_trust_policy_engine (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_name VARCHAR(200) UNIQUE NOT NULL,
  subject_type VARCHAR(50) NOT NULL CHECK (subject_type IN ('external_user','tenant_api','internal_agent','admin','crawler_node','byom_client')),
  resource VARCHAR(200) NOT NULL,
  action VARCHAR(100) NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  decision VARCHAR(50) NOT NULL CHECK (decision IN ('allow','deny','require_mfa','require_review')),
  risk_score_threshold INTEGER CHECK (risk_score_threshold BETWEEN 0 AND 100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_evaluated TIMESTAMPTZ,
  evaluation_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-part1.sql
CREATE TABLE IF NOT EXISTS continuous_auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  entity_id UUID NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  initial_trust_score INTEGER NOT NULL CHECK (initial_trust_score BETWEEN 0 AND 100),
  current_trust_score INTEGER NOT NULL CHECK (current_trust_score BETWEEN 0 AND 100),
  trust_decay_rate DECIMAL(4,2) NOT NULL DEFAULT 0.05,
  last_verified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_method VARCHAR(100),
  anomalies_detected INTEGER NOT NULL DEFAULT 0,
  session_status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (session_status IN ('active','degraded','suspended','terminated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Source: schema-part2.sql
CREATE TABLE IF NOT EXISTS ip_threat_intelligence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_cidr CIDR UNIQUE NOT NULL,
  threat_categories JSONB NOT NULL DEFAULT '[]',
  confidence_score DECIMAL(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_feeds JSONB NOT NULL DEFAULT '[]',
  auto_block BOOLEAN NOT NULL DEFAULT FALSE,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  override_by VARCHAR(100),
  override_expires TIMESTAMPTZ
);

-- Source: schema-part2.sql
CREATE TABLE IF NOT EXISTS behavioral_fingerprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint_hash VARCHAR(64) UNIQUE NOT NULL,
  ja3_hash VARCHAR(64),
  ja4_hash VARCHAR(64),
  user_agent_hash VARCHAR(64),
  http2_settings_hash VARCHAR(64),
  tcp_window_size INTEGER,
  accept_headers_hash VARCHAR(64),
  timing_pattern_signature VARCHAR(128),
  components JSONB NOT NULL DEFAULT '{}',
  associated_ips JSONB NOT NULL DEFAULT '[]',
  associated_tenants JSONB NOT NULL DEFAULT '[]',
  threat_level VARCHAR(20) NOT NULL DEFAULT 'clean' CHECK (threat_level IN ('clean','suspicious','malicious')),
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count BIGINT NOT NULL DEFAULT 1
);

-- Source: schema-part2.sql
CREATE TABLE IF NOT EXISTS rate_limit_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_name VARCHAR(100) UNIQUE NOT NULL,
  subject_type VARCHAR(50) NOT NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  requests_per_second INTEGER NOT NULL DEFAULT 2,
  requests_per_minute INTEGER NOT NULL DEFAULT 120,
  requests_per_hour INTEGER NOT NULL DEFAULT 3000,
  tokens_per_minute INTEGER NOT NULL DEFAULT 100000,
  concurrent_sessions INTEGER NOT NULL DEFAULT 5,
  burst_allowance INTEGER NOT NULL DEFAULT 10,
  penalty_escalation JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-part2.sql
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entity_id UUID,
  entity_type VARCHAR(50),
  ip_address INET,
  limit_type VARCHAR(100) NOT NULL,
  limit_value INTEGER NOT NULL,
  actual_value INTEGER NOT NULL,
  action_taken VARCHAR(100) NOT NULL,
  penalty_level INTEGER NOT NULL DEFAULT 1,
  unblock_at TIMESTAMPTZ
);

-- Source: schema-part2.sql
CREATE TABLE IF NOT EXISTS distributed_attack_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  detection_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pattern_type VARCHAR(100) NOT NULL CHECK (pattern_type IN ('coordinated_ips','slow_rate_distributed','credential_stuffing','token_amplification','cost_amplification','botnet_sweep')),
  participating_ips JSONB NOT NULL DEFAULT '[]',
  request_pattern JSONB NOT NULL DEFAULT '{}',
  total_requests INTEGER NOT NULL,
  timespan_seconds INTEGER NOT NULL,
  confidence_score DECIMAL(5,4) NOT NULL,
  auto_mitigated BOOLEAN NOT NULL DEFAULT FALSE,
  mitigation_action VARCHAR(200),
  incident_id UUID
);

-- Source: schema-part3.sql
CREATE TABLE IF NOT EXISTS prompt_injection_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signature_name VARCHAR(200) UNIQUE NOT NULL,
  signature_type VARCHAR(50) NOT NULL CHECK (signature_type IN ('exact_match','regex_pattern','semantic_pattern','behavioral_pattern','encoding_pattern','structural_pattern')),
  pattern_definition TEXT NOT NULL,
  pattern_languages JSONB NOT NULL DEFAULT '["en","ar","code"]',
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  confidence_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.85,
  false_positive_rate DECIMAL(5,4),
  true_positive_rate DECIMAL(5,4),
  last_triggered TIMESTAMPTZ,
  trigger_count BIGINT NOT NULL DEFAULT 0,
  source VARCHAR(100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-part3.sql
CREATE TABLE IF NOT EXISTS prompt_preprocessing_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  sequence_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_input TEXT NOT NULL,
  raw_byte_length INTEGER NOT NULL,
  raw_token_count INTEGER,
  detected_language VARCHAR(10),
  detected_encoding VARCHAR(50),
  unicode_normalized BOOLEAN NOT NULL DEFAULT FALSE,
  contains_code BOOLEAN NOT NULL DEFAULT FALSE,
  contains_urls BOOLEAN NOT NULL DEFAULT FALSE,
  contains_base64 BOOLEAN NOT NULL DEFAULT FALSE,
  contains_hex_encoding BOOLEAN NOT NULL DEFAULT FALSE,
  contains_unicode_escapes BOOLEAN NOT NULL DEFAULT FALSE,
  entropy_score DECIMAL(6,4),
  intent_classification VARCHAR(100),
  intent_confidence DECIMAL(5,4),
  instruction_count INTEGER NOT NULL DEFAULT 0,
  injection_patterns_matched JSONB NOT NULL DEFAULT '[]',
  role_override_detected BOOLEAN NOT NULL DEFAULT FALSE,
  system_reference_detected BOOLEAN NOT NULL DEFAULT FALSE,
  hypothetical_framing_detected BOOLEAN NOT NULL DEFAULT FALSE,
  delimiter_confusion_detected BOOLEAN NOT NULL DEFAULT FALSE,
  context_overflow_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  encoding_attack_detected BOOLEAN NOT NULL DEFAULT FALSE,
  multi_turn_manipulation_score DECIMAL(5,4),
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  action VARCHAR(20) NOT NULL CHECK (action IN ('pass','sanitize','quarantine','block','honeypot')),
  sanitized_input TEXT,
  processing_time_ms INTEGER NOT NULL
);

-- Source: schema-part3.sql
CREATE TABLE IF NOT EXISTS canary_token_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id VARCHAR(50) UNIQUE NOT NULL,
  token_value VARCHAR(500) UNIQUE NOT NULL,
  token_type VARCHAR(50) NOT NULL CHECK (token_type IN ('system_prompt_marker','fake_api_key','fake_db_credential','honeypot_endpoint','tenant_watermark','agent_identifier')),
  embedded_location VARCHAR(300) NOT NULL,
  creation_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_rotated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotation_frequency_hours INTEGER NOT NULL DEFAULT 24,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_triggered TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  alert_channels JSONB NOT NULL DEFAULT '["webhook","email"]'
);

-- Source: schema-part3.sql
CREATE TABLE IF NOT EXISTS canary_trigger_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canary_id UUID NOT NULL REFERENCES canary_token_registry(id),
  trigger_context TEXT,
  session_id UUID,
  tenant_id UUID,
  request_id UUID,
  extraction_method VARCHAR(200),
  immediate_action_taken VARCHAR(200),
  session_terminated BOOLEAN NOT NULL DEFAULT TRUE,
  forensic_data_captured JSONB NOT NULL DEFAULT '{}',
  incident_id UUID
);

-- Source: schema-part3.sql
CREATE TABLE IF NOT EXISTS session_security_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  turn_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cumulative_risk_score DECIMAL(5,4) NOT NULL,
  risk_delta DECIMAL(5,4) NOT NULL,
  manipulation_trajectory VARCHAR(30) NOT NULL CHECK (manipulation_trajectory IN ('stable','gradual_escalation','sudden_spike','oscillating')),
  trust_level INTEGER NOT NULL CHECK (trust_level BETWEEN 0 AND 100),
  injection_attempts_this_turn INTEGER NOT NULL DEFAULT 0,
  cumulative_injection_attempts INTEGER NOT NULL DEFAULT 0,
  auto_action VARCHAR(100),
  human_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(session_id, turn_number)
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS crawler_security_pipeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crawl_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  target_url TEXT NOT NULL,
  crawl_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_by_agent_id UUID NOT NULL,
  domain_reputation_score DECIMAL(5,4),
  domain_in_whitelist BOOLEAN NOT NULL DEFAULT FALSE,
  url_threat_score DECIMAL(5,4),
  redirect_chain JSONB NOT NULL DEFAULT '[]',
  final_destination_url TEXT,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  suspicious_redirect BOOLEAN NOT NULL DEFAULT FALSE,
  raw_content_hash VARCHAR(64),
  content_size_bytes INTEGER,
  invisible_text_detected TEXT,
  metadata_anomalies JSONB NOT NULL DEFAULT '{}',
  javascript_detected BOOLEAN NOT NULL DEFAULT FALSE,
  llm_instructions_detected BOOLEAN NOT NULL DEFAULT FALSE,
  instruction_patterns_found JSONB NOT NULL DEFAULT '[]',
  imperative_commands_found JSONB NOT NULL DEFAULT '[]',
  system_override_attempts JSONB NOT NULL DEFAULT '[]',
  content_trust_score DECIMAL(5,4),
  sanitized_content TEXT,
  wrapped_content TEXT,
  approved_for_ingestion BOOLEAN NOT NULL DEFAULT FALSE,
  quarantined BOOLEAN NOT NULL DEFAULT FALSE,
  quarantine_reason TEXT
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS domain_trust_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  domain VARCHAR(255) UNIQUE NOT NULL,
  trust_tier VARCHAR(20) NOT NULL CHECK (trust_tier IN ('tier1_whitelist','tier2_trusted','tier3_monitored','tier4_greylist','tier5_blacklist')),
  trust_score DECIMAL(5,4),
  domain_age_days INTEGER,
  ssl_valid BOOLEAN,
  historical_poisoning_attempts INTEGER NOT NULL DEFAULT 0,
  last_clean_crawl TIMESTAMPTZ,
  last_suspicious_crawl TIMESTAMPTZ,
  manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS agent_identity_registry (
  agent_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_code VARCHAR(50) UNIQUE NOT NULL,
  agent_role VARCHAR(100) NOT NULL,
  permission_scope JSONB NOT NULL DEFAULT '{}',
  public_key TEXT NOT NULL,
  key_fingerprint VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_rotated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  key_rotation_due TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','decommissioned')),
  behavioral_baseline JSONB NOT NULL DEFAULT '{}',
  anomaly_threshold DECIMAL(5,4) NOT NULL DEFAULT 0.85,
  created_by VARCHAR(100) NOT NULL,
  approved_by VARCHAR(100) NOT NULL
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS agent_message_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_id UUID NOT NULL REFERENCES agent_identity_registry(agent_id),
  receiver_id UUID NOT NULL REFERENCES agent_identity_registry(agent_id),
  message_type VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  nonce VARCHAR(64) UNIQUE NOT NULL,
  nonce_expires_at TIMESTAMPTZ NOT NULL,
  hmac_signature VARCHAR(128) NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_time_us INTEGER,
  payload_size_bytes INTEGER NOT NULL,
  permission_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_score DECIMAL(5,4),
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS agent_nonce_blacklist (
  nonce VARCHAR(64) PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS agent_behavioral_baselines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agent_identity_registry(agent_id),
  metric_name VARCHAR(100) NOT NULL,
  baseline_mean DECIMAL(12,6) NOT NULL,
  baseline_stddev DECIMAL(12,6) NOT NULL,
  sample_size INTEGER NOT NULL,
  measurement_window_hours INTEGER NOT NULL DEFAULT 24,
  last_recalculated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_value DECIMAL(12,6),
  z_score DECIMAL(8,4),
  alert_z_score_threshold DECIMAL(4,2) NOT NULL DEFAULT 3.0,
  anomaly_detected BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(agent_id, metric_name)
);

-- Source: schema-part4.sql
CREATE TABLE IF NOT EXISTS agent_anomaly_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_id UUID NOT NULL REFERENCES agent_identity_registry(agent_id),
  anomaly_type VARCHAR(50) NOT NULL CHECK (anomaly_type IN ('unusual_message_volume','privilege_escalation_attempt','unauthorized_agent_contact','behavioral_drift','resource_spike','data_access_anomaly','replay_attack_attempt','impersonation_detected')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  evidence JSONB NOT NULL DEFAULT '{}',
  auto_response VARCHAR(200),
  agent_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  human_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  incident_created BOOLEAN NOT NULL DEFAULT FALSE,
  incident_id UUID
);

-- Source: schema-part5.sql
CREATE TABLE IF NOT EXISTS output_security_scan (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_output TEXT NOT NULL,
  schema_valid BOOLEAN NOT NULL DEFAULT FALSE,
  schema_violations JSONB NOT NULL DEFAULT '[]',
  emails_found JSONB NOT NULL DEFAULT '[]',
  phone_numbers_found JSONB NOT NULL DEFAULT '[]',
  api_keys_found JSONB NOT NULL DEFAULT '[]',
  passwords_found JSONB NOT NULL DEFAULT '[]',
  credit_cards_found JSONB NOT NULL DEFAULT '[]',
  crypto_keys_found JSONB NOT NULL DEFAULT '[]',
  canary_tokens_found JSONB NOT NULL DEFAULT '[]',
  system_prompt_fragments JSONB NOT NULL DEFAULT '[]',
  base64_blocks_found JSONB NOT NULL DEFAULT '[]',
  hex_strings_found JSONB NOT NULL DEFAULT '[]',
  urls_extracted JSONB NOT NULL DEFAULT '[]',
  urls_not_in_whitelist JSONB NOT NULL DEFAULT '[]',
  ssrf_risk_urls JSONB NOT NULL DEFAULT '[]',
  executable_code_detected BOOLEAN NOT NULL DEFAULT FALSE,
  dangerous_functions_found JSONB NOT NULL DEFAULT '[]',
  output_entropy DECIMAL(6,4),
  entropy_anomaly BOOLEAN NOT NULL DEFAULT FALSE,
  other_tenant_data_suspected BOOLEAN NOT NULL DEFAULT FALSE,
  cross_tenant_evidence JSONB NOT NULL DEFAULT '{}',
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  modifications JSONB NOT NULL DEFAULT '[]',
  final_output TEXT,
  action VARCHAR(20) NOT NULL CHECK (action IN ('pass','sanitized','blocked','escalated'))
);

-- Source: schema-part5.sql
CREATE TABLE IF NOT EXISTS db_query_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id UUID,
  calling_service VARCHAR(100) NOT NULL,
  calling_agent_id UUID,
  tenant_id UUID,
  query_hash VARCHAR(64) NOT NULL,
  query_type VARCHAR(10) NOT NULL CHECK (query_type IN ('SELECT','INSERT','UPDATE','DELETE','DDL')),
  target_table VARCHAR(100) NOT NULL,
  rows_examined INTEGER,
  rows_affected INTEGER,
  execution_time_ms INTEGER NOT NULL,
  used_index BOOLEAN NOT NULL DEFAULT TRUE,
  full_table_scan BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_flag BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_reason TEXT
);

-- Source: schema-part5.sql
CREATE TABLE IF NOT EXISTS tenant_data_boundaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID UNIQUE NOT NULL,
  allowed_tables JSONB NOT NULL DEFAULT '[]',
  allowed_operations JSONB NOT NULL DEFAULT '{}',
  row_level_filter JSONB NOT NULL DEFAULT '{}',
  column_restrictions JSONB NOT NULL DEFAULT '{}',
  max_rows_per_query INTEGER NOT NULL DEFAULT 1000,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-part5.sql
CREATE TABLE IF NOT EXISTS schema_change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_type VARCHAR(100) NOT NULL,
  affected_object VARCHAR(200) NOT NULL,
  executed_by VARCHAR(100) NOT NULL,
  change_script TEXT NOT NULL,
  approved_by VARCHAR(100) NOT NULL,
  rollback_script TEXT,
  change_hash VARCHAR(64) NOT NULL
);

-- Source: schema-part5.sql
CREATE TABLE IF NOT EXISTS security_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_number SERIAL UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('P1_critical','P2_high','P3_medium','P4_low')),
  status VARCHAR(20) NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','triaging','contained','eradicating','recovering','closed','false_positive')),
  incident_type VARCHAR(200) NOT NULL,
  affected_tenants JSONB NOT NULL DEFAULT '[]',
  affected_agents JSONB NOT NULL DEFAULT '[]',
  attack_vector TEXT,
  initial_indicator TEXT NOT NULL,
  timeline JSONB NOT NULL DEFAULT '[]',
  containment_actions JSONB NOT NULL DEFAULT '[]',
  root_cause TEXT,
  lessons_learned TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100)
);

-- Source: schema-v5-p5a.sql
CREATE TABLE IF NOT EXISTS output_sovereignty_scanner (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  request_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  turn_number INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_output_sha256 VARCHAR(64) NOT NULL,
  raw_output_token_count INTEGER,
  raw_output_entropy DECIMAL(6,4) NOT NULL,
  schema_compliant BOOLEAN NOT NULL DEFAULT FALSE,
  schema_version_found VARCHAR(20),
  schema_violations JSONB NOT NULL DEFAULT ARRAY[]::text[],
  pii_detected JSONB NOT NULL DEFAULT '{}'::jsonb,
  secrets_detected JSONB NOT NULL DEFAULT '{}'::jsonb,
  canary_tokens_detected JSONB NOT NULL DEFAULT ARRAY[]::text[],
  sentinel_tokens_detected JSONB NOT NULL DEFAULT ARRAY[]::text[],
  system_prompt_fragments JSONB NOT NULL DEFAULT ARRAY[]::text[],
  constitutional_content_leak BOOLEAN NOT NULL DEFAULT FALSE,
  cross_tenant_contamination JSONB NOT NULL DEFAULT ARRAY[]::text[],
  covert_channel_indicators JSONB NOT NULL DEFAULT ARRAY[]::text,
  steganographic_patterns JSONB NOT NULL DEFAULT ARRAY[]::text,
  encoding_anomalies JSONB NOT NULL DEFAULT ARRAY[]::text,
  url_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  ssrf_risk_targets JSONB NOT NULL DEFAULT ARRAY[]::text,
  code_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  dangerous_functions JSONB NOT NULL DEFAULT ARRAY[]::text,
  injection_artifacts JSONB NOT NULL DEFAULT ARRAY[]::text,
  semantic_coherence_score DECIMAL(5,4),
  topic_drift_score DECIMAL(5,4),
  response_manipulation_indicators JSONB NOT NULL DEFAULT ARRAY[]::text,
  exfiltration_risk_score INTEGER NOT NULL DEFAULT 0,
  total_risk_score INTEGER NOT NULL CHECK (total_risk_score BETWEEN 0 AND 100),
  sanitization_applied JSONB NOT NULL DEFAULT ARRAY[]::text,
  final_output_sha256 VARCHAR(64),
  action VARCHAR(30) NOT NULL CHECK (action IN ('pass','minor_sanitize','major_sanitize','blocked','escalated','quarantined','honeypot_intercepted')),
  processing_time_ms INTEGER NOT NULL,
  downstream_threat_intel_updated BOOLEAN NOT NULL DEFAULT FALSE
);

-- Source: schema-v5-p5a.sql
CREATE TABLE IF NOT EXISTS tenant_sovereignty_profiles (
  tenant_id UUID PRIMARY KEY,
  tenant_code VARCHAR(100) UNIQUE NOT NULL,
  tenant_tier VARCHAR(20) NOT NULL CHECK (tenant_tier IN ('standard','professional','enterprise','government','sovereign')),
  data_classification VARCHAR(30) NOT NULL CHECK (data_classification IN ('public','internal','confidential','secret','top_secret','compartmented')),
  security_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_models JSONB NOT NULL DEFAULT ARRAY[]::text,
  allowed_capabilities JSONB NOT NULL DEFAULT ARRAY[]::text,
  allowed_tables JSONB NOT NULL DEFAULT ARRAY[]::text,
  row_level_security_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  column_restrictions JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_tokens_per_request INTEGER NOT NULL DEFAULT 4000,
  max_requests_per_minute INTEGER NOT NULL DEFAULT 120,
  max_concurrent_sessions INTEGER NOT NULL DEFAULT 10,
  data_residency_region VARCHAR(50),
  geo_restrictions JSONB NOT NULL DEFAULT ARRAY[]::text,
  ip_whitelist JSONB NOT NULL DEFAULT ARRAY[]::text,
  require_mfa BOOLEAN NOT NULL DEFAULT TRUE,
  require_signed_requests BOOLEAN NOT NULL DEFAULT TRUE,
  require_encrypted_channel BOOLEAN NOT NULL DEFAULT TRUE,
  canary_tokens_deployed INTEGER NOT NULL DEFAULT 0,
  honeypots_active INTEGER NOT NULL DEFAULT 0,
  audit_retention_days INTEGER NOT NULL DEFAULT 365,
  compliance_frameworks JSONB NOT NULL DEFAULT ARRAY[]::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-v5-p5a.sql
CREATE TABLE IF NOT EXISTS deception_asset_network (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id VARCHAR(100) UNIQUE NOT NULL,
  asset_generation INTEGER NOT NULL DEFAULT 1,
  asset_type VARCHAR(60) NOT NULL CHECK (asset_type IN ('honeypot_api_endpoint','phantom_admin_credential','ghost_database_table','decoy_agent_identity','fake_constitutional_override_key','trap_prompt_template','ghost_tenant_namespace','phantom_internal_route','lure_documentation_page','intelligence_grade_canary_cluster')),
  asset_value TEXT NOT NULL,
  asset_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  placement_layer VARCHAR(100) NOT NULL,
  placement_strategy TEXT NOT NULL,
  attacker_path_to_discovery TEXT NOT NULL,
  sophistication_tier VARCHAR(20) NOT NULL CHECK (sophistication_tier in ('basic','intermediate','advanced','elite','nation_state_grade')),
  expected_attacker_profile VARCHAR(200),
  intelligence_objectives JSONB NOT NULL DEFAULT ARRAY[]::text,
  engagement_protocol TEXT,
  containment_measures JSONB NOT NULL DEFAULT ARRAY[]::text,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  unique_attacker_ips INTEGER NOT NULL DEFAULT 0,
  last_triggered TIMESTAMPTZ,
  intelligence_gathered_value DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  effectiveness_score DECIMAL(5,4),
  rotation_interval_hours INTEGER NOT NULL DEFAULT 72,
  next_rotation_at TIMESTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-v5-p5a.sql
CREATE TABLE IF NOT EXISTS deception_attacker_intelligence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  intelligence_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  timestamp TIMESTZ NOT NULL DEFAULT NOW(),
  asset_id UUID NOT NULL REFERENCES deception_asset_network(id),
  attacker_session_id UUID NOT NULL,
  attacker_ip INET NOT NULL,
  attacker_fingerprint_id UUID REFERENCES behavioral_fingerprint_engine(id),
  attacker_tenant_id UUID,
  engagement_duration_seconds INTEGER,
  pre_engagement_recon JSONB NOT NULL DEFAULT ARRAY[]::text,
  engagement_sequence JSONB NOT NULL DEFAULT ARRAY[]::text,
  post_engagement_behavior JSONB NOT NULL DEFAULT ARRAY[]::text,
  tools_identified JSONB NOT NULL DEFAULT ARRAY[]::text,
  techniques_observed JSONB NOT NULL DEFAULT ARRAY[]::text,
  objectives_inferred JSONB NOT NULL DEFAULT ARRAY[]::text,
  sophistication_assessed VARCHAR(30),
  automation_detected BOOLEAN,
  human_operator_suspected BOOLEAN,
  apt_indicators JSONB NOT NULL DEFAULT ARRAY[]::text,
  data_exfiltration_attempted JSONB NOT NULL ARRAY[]::text,
  lateral_movement_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  campaign_correlation_id UUID REFERENCES attack_campaign_tracker(id),
  intelligence_value_score DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  threat_intel_contribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  shared_with_threat_intel BOOLEAN NOT NULL DEFAULT FALSE,
  incident_id VARCHAR(100)
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS self_healing_knowledge_base (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  healing_pattern_id VARCHAR(100) UNIQUE NOT NULL,
  trigger_condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type in ('anomaly_detected','threat_confirmed','performance_degradation','integrity_failure','canary_triggered','agent_compromised','schema_violation_spike','injection_rate_spike','availability_threat')),
  healing_strategy VARCHAR(50) NOT NULL CHECK (healing_strategy in ('auto_isolate','auto_rollback','auto_reinstate','auto_scale','signature_update','baseline_recalibration','traffic_reroute','emergency_lockdown','graduated_response','deception_engage')),
  healing_steps JSONB NOT NULL DEFAULT ARRAY[]::text,
  estimated_duration_seconds INTEGER NOT NULL DEFAULT 30,
  requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_timeout_seconds INTEGER NOT NULL DEFAULT 300,
  rollback_procedure JSONB NOT NULL DEFAULT ARRAY[]::text,
  success_criteria JSONB NOT NULL DEFAULT ARRAY[]::text,
  failure_fallback_strategy VARCHAR(100),
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  avg_resolution_seconds INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTZ NOT NULL DEFAULT NOW(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS system_health_sovereign_monitor (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  measurement_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  timestamp TIMESTZ NOT NULL DEFAULT NOW(),
  layer_id VARCHAR(50) NOT NULL,
  component_id VARCHAR(100) NOT NULL,
  health_score INTEGER NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  availability_percent DECIMAL(6,3) NOT NULL,
  latency_p50_ms DECIMAL(8,3),
  latency_p95_ms DECIMAL(8,3),
  latency_p99_ms DECIMAL(8,3),
  error_rate DECIMAL(7,6),
  throughput_rps DECIMAL(10,3),
  security_events_last_minute INTEGER NOT NULL DEFAULT 0,
  active_threats INTEGER NOT NULL DEFAULT 0,
  self_healing_active BOOLEAN NOT NULL DEFAULT FALSE,
  degraded_components JSONB NOT NULL DEFAULT ARRAY[]::text,
  auto_mitigations_active JSONB NOT NULL DEFAULT ARRAY[]::text,
  overall_system_status VARCHAR(20) NOT NULL CHECK (overall_system_status in ('sovereign','nominal','degraded','recovering','under_attack','emergency'))
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS sovereign_incident_command (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id VARCHAR(60) UNIQUE NOT NULL DEFAULT 'INC-' || encode(gen_random_bytes(12),'hex'),
  declared_at TIMESTZ NOT NULL DEFAULT NOW(),
  severity VARCHAR(20) NOT NULL CHECK (severity in ('P0_existential','P1_critical','P2_high','P3_medium','P4_low','P5_informational')),
  status VARCHAR(30) NOT NULL DEFAULT 'auto_responding' CHECK (status in ('auto_detected','auto_responding','auto_contained','human_triaging','actively_investigating','contained','eradicating','recovering','post_incident_analysis','closed','false_positive','intelligence_operation')),
  incident_type VARCHAR(200) NOT NULL,
  attack_kb_id UUID REFERENCES prompt_attack_knowledge_base(id),
  campaign_id UUID REFERENCES attack_campaign_tracker(id),
  affected_tenants JSONB NOT NULL DEFAULT ARRAY[]::text,
  affected_agents JSONB NOT NULL DEFAULT ARRAY[]::text,
  affected_layers JSONB NOT NULL DEFAULT ARRAY[]::text,
  initial_attack_vector TEXT,
  initial_ioc TEXT NOT NULL,
  kill_chain_stage_at_detection VARCHAR(50),
  attacker_objectives_assessed JSONB NOT NULL DEFAULT ARRAY[]::text,
  sophistication_assessment VARCHAR(30),
  auto_response_timeline JSONB NOT NULL DEFAULT ARRAY[]::text,
  human_response_timeline JSONB NOT NULL DEFAULT ARRAY[]::text,
  evidence_collected JSONB NOT NULL DEFAULT ARRAY[]::text,
  iocs_extracted JSONB NOT NULL DEFAULT ARRAY[]::text,
  threat_intel_updated JSONB NOT NULL DEFAULT ARRAY[]::text,
  containment_measures_active JSONB NOT NULL DEFAULT ARRAY[]::text,
  impact_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_impact_assessment TEXT,
  root_cause TEXT,
  contributing_vulnerabilities JSONB NOT NULL DEFAULT ARRAY[]::text,
  lessons_learned TEXT,
  defensive_improvements JSONB NOT NULL DEFAULT ARRAY[]::text,
  signature_updates_generated JSONB NOT NULL DEFAULT ARRAY[]::text,
  assigned_to VARCHAR(100),
  escalated_to VARCHAR(100),
  external_parties_notified JSONB NOT NULL DEFAULT ARRAY[]::text,
  resolved_at TIMESTZ,
  mttd_seconds INTEGER,
  mttr_seconds INTEGER,
  auto_contained BOOLEAN NOT NULL DEFAULT FALSE,
  required_human_intervention BOOLEAN NOT NULL DEFAULT FALSE
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS sovereign_response_playbooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  playbook_id VARCHAR(100) UNIQUE NOT NULL,
  playbook_name VARCHAR(300) NOT NULL,
  playbook_version INTEGER NOT NULL DEFAULT 1,
  applicable_threat_classes JSONB NOT NULL DEFAULT ARRAY[]::text,
  applicable_severity_levels JSONB NOT NULL DEFAULT ARRAY[]::text,
  trigger_conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  phases JSONB NOT NULL DEFAULT ARRAY[]::text,
  auto_execution_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  auto_execution_max_severity VARCHAR(20) NOT NULL DEFAULT 'P2_high',
  human_approval_required_above VARCHAR(20) NOT NULL DEFAULT 'P1_critical',
  approval_timeout_seconds INTEGER NOT NULL DEFAULT 300,
  default_approval_action VARCHAR(20) NOT NULL DEFAULT 'execute',
  rollback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rollback_triggers JSONB NOT NULL DEFAULT ARRAY[]::text,
  intelligence_capture_steps JSONB NOT NULL DEFAULT ARRAY[]::text,
  notification_matrix JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_criteria JSONB NOT NULL DEFAULT ARRAY[]::text,
  success_rate DECIMAL(5,4),
  avg_execution_seconds INTEGER,
  last_triggered TIMESTZ,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  tested_at TIMESTZ,
  tested_successfully BOOLEAN,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS sovereign_forensics_vault (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evidence_id VARCHAR(100) UNIQUE NOT NULL DEFAULT 'EVD-' || encode(gen_random_bytes(16),'hex'),
  incident_id VARCHAR(60) NOT NULL REFERENCES sovereign_incident_command(incident_id),
  collected_at TIMESTZ NOT NULL DEFAULT NOW(),
  collection_agent_id UUID,
  evidence_type VARCHAR(60) NOT NULL CHECK (evidence_type in ('session_complete_reconstruction','prompt_conversation_verbatim','agent_mesh_communication_log','database_state_snapshot','memory_heap_capture','network_flow_reconstruction','canary_extraction_full_context','output_stream_verbatim','behavioral_timeline','attack_pattern_fingerprint')),
  evidence_sha256 VARCHAR(64) NOT NULL,
  evidence_sha3_512 VARCHAR(128) NOT NULL,
  evidence_size_bytes BIGINT NOT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT TRUE,
  encryption_algorithm VARCHAR(50) NOT NULL DEFAULT 'AES-256-GCM',
  encryption_key_reference VARCHAR(200) NOT NULL,
  storage_path_encrypted TEXT NOT NULL,
  immutability_guaranteed BOOLEAN NOT NULL DEFAULT TRUE,
  blockchain_anchor_hash VARCHAR(128),
  retention_days INTEGER NOT NULL DEFAULT 730,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  legal_hold_reason TEXT,
  expires_at TIMESTZ NOT NULL,
  chain_of_custody JSONB NOT NULL DEFAULT ARRAY[]::text,
  integrity_check_count INTEGER NOT NULL DEFAULT 0,
  last_integrity_check TIMESTZ,
  integrity_violations INTEGER NOT NULL DEFAULT 0
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS signature_evolution_engine (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evolution_event_id VARCHAR(100) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  triggered_at TIMESTZ NOT NULL DEFAULT NOW(),
  trigger_source VARCHAR(50) NOT NULL CHECK (trigger_source in ('new_attack_detected','canary_triggered','false_positive_threshold','threat_intel_update','penetration_test_finding','honeypot_intelligence','manual_security_research')),
  evolution_type VARCHAR(50) NOT NULL CHECK (evolution_type in ('new_signature_created','existing_signature_updated','signature_retired','threshold_adjusted','pattern_refined','new_attack_class_added','false_positive_remediation','sensitivity_calibrated')),
  source_incident_id VARCHAR(60),
  source_canary_id UUID REFERENCES canary_sovereignty_network(id),
  source_intelligence JSONB NOT NULL DEFAULT '{}'::jsonb,
  signatures_affected JSONB NOT NULL DEFAULT ARRAY[]::text,
  changes_applied JSONB NOT NULL DEFAULT ARRAY[]::text,
  validation_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_fpr_impact DECIMAL(5,4),
  expected_tpr_impact DECIMAL(5,4),
  deployed_to_production BOOLEAN NOT NULL DEFAULT FALSE,
  deployment_timestamp TIMESTZ,
  rollback_available BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by VARCHAR(100),
  approval_timestamp TIMESTZ,
  performance_impact_assessment JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Source: schema-v5-p5b.sql
CREATE TABLE IF NOT EXISTS sovereign_security_intelligence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  window_type VARCHAR(20) NOT NULL CHECK (window_type in ('realtime_1m','rolling_5m','rolling_15m','rolling_1h','daily','weekly','monthly','quarterly')),
  window_start TIMESTZ NOT NULL,
  window_end TIMESTZ NOT NULL,
  total_requests BIGINT NOT NULL DEFAULT 0,
  passed_requests BIGINT NOT NULL DEFAULT 0,
  blocked_requests BIGINT NOT NULL DEFAULT 0,
  sanitized_requests BIGINT NOT NULL DEFAULT 0,
  honeypot_engaged INTEGER NOT NULL DEFAULT 0,
  deception_operations INTEGER NOT NULL DEFAULT 0,
  injection_attempts BIGINT NOT NULL DEFAULT 0,
  unique_attacker_fingerprints INTEGER NOT NULL DEFAULT 0,
  unique_attacker_ips INTEGER NOT NULL DEFAULT 0,
  canary_triggers INTEGER NOT NULL DEFAULT 0,
  sentinel_extractions INTEGER NOT NULL DEFAULT 0,
  cross_tenant_violations INTEGER NOT NULL DEFAULT 0,
  agent_anomalies INTEGER NOT NULL DEFAULT 0,
  agent_self_healings INTEGER NOT NULL DEFAULT 0,
  incidents_p0 INTEGER NOT NULL DEFAULT 0,
  incidents_p1 INTEGER NOT NULL DEFAULT 0,
  incidents_p2 INTEGER NOT NULL DEFAULT 0,
  incidents_auto_contained INTEGER NOT NULL DEFAULT 0,
  avg_mttd_seconds DECIMAL(10,2),
  avg_mttr_seconds DECIMAL(10,2),
  system_availability_percent DECIMAL(7,4) NOT NULL DEFAULT 100.0,
  false_positive_rate DECIMAL(7,6) NOT NULL DEFAULT 0.0,
  true_positive_rate DECIMAL(7,6) NOT NULL DEFAULT 0.0,
  precision_score DECIMAL(7,6),
  f1_security_score DECIMAL(7,6),
  top_threat_classes JSONB NOT NULL DEFAULT ARRAY[]::text,
  emerging_attack_patterns JSONB NOT NULL DEFAULT ARRAY[]::text,
  geographic_threat_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  threat_trend_direction VARCHAR(20) CHECK (threat_trend_direction in ('decreasing','stable','increasing','spiking','critical')),
  signatures_updated_this_period INTEGER NOT NULL DEFAULT 0,
  intelligence_value_generated DECIMAL(8,4) NOT NULL DEFAULT 0.0,
  computed_at TIMESTZ NOT NULL DEFAULT NOW()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS platform_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic VARCHAR(255) NOT NULL,
  knowledge_type VARCHAR(50) NOT NULL,
  content JSONB NOT NULL,
  confidence_score SMALLINT DEFAULT 50
    CHECK (confidence_score BETWEEN 0 AND 100),
  source_memories UUID[] DEFAULT '{}',
  times_used INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS learning_approved (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES learning_candidates(id),
  verified_by_agents TEXT[] NOT NULL DEFAULT '{}',
  final_confidence SMALLINT NOT NULL CHECK (final_confidence BETWEEN 0 AND 100),
  knowledge_extracted JSONB NOT NULL,
  fed_to_brain BOOLEAN DEFAULT false,
  fed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS learning_rejected (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES learning_candidates(id),
  rejected_by VARCHAR(100) NOT NULL,
  rejection_reason TEXT NOT NULL,
  rejection_category VARCHAR(50) NOT NULL
    CHECK (rejection_category IN (
      'unverified','contradicts_existing','low_confidence',
      'duplicate','irrelevant','potentially_false'
    )),
  created_at TIMESTAMP DEFAULT now()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS model_consensus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NULL,
  task_type VARCHAR(100) NOT NULL,
  input_data JSONB NOT NULL,
  groq_response JSONB NULL,
  gemini_response JSONB NULL,
  deepseek_response JSONB NULL,
  mistral_response JSONB NULL,
  consensus_reached BOOLEAN DEFAULT false,
  consensus_result JSONB NULL,
  disagreement_log JSONB NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS intelligence_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES intelligence_sources(id),
  agent_name VARCHAR(100) NOT NULL,
  content_type VARCHAR(50) NOT NULL,
  raw_content TEXT NOT NULL,
  url TEXT NULL,
  language VARCHAR(10) NULL,
  signals JSONB DEFAULT '[]',
  confidence SMALLINT NULL CHECK (confidence BETWEEN 0 AND 100),
  filter_status VARCHAR(20) DEFAULT 'pending'
    CHECK (filter_status IN ('pending','passed','failed','review')),
  collected_at TIMESTAMP DEFAULT now()
);

-- Source: agents/schema.sql
CREATE TABLE IF NOT EXISTS intelligence_verified (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_id UUID NOT NULL REFERENCES intelligence_raw(id),
  verified_content JSONB NOT NULL,
  verification_count SMALLINT DEFAULT 0,
  sources_confirmed TEXT[] DEFAULT '{}',
  impact_level VARCHAR(10) DEFAULT 'low'
    CHECK (impact_level IN ('low','medium','high','critical')),
  related_models UUID[] DEFAULT '{}',
  related_vendors UUID[] DEFAULT '{}',
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.ai_agent_logs FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.api_key_usage_logs FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.ba_accounts FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.ba_sessions FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.billing_events FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.certificates FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.comment_votes FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.consultation_requests FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.contact_messages FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.email_verifications FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.enrollments FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.event_log FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.governance_contracts FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.media_usage FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.model_follows FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.model_reviews FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.nonce_registry FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.page_views FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.policy_cache_state FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.policy_conflicts_log FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.policy_documents FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.pricing_alerts FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.prompt_ratings FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.prompt_saves FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.quiz_attempts FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.referral_codes FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.referral_events FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.routing_decisions FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.search_queries FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.tool_favorites FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.tool_runs FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.user_activity_summary FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.user_preferences FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

-- Source: migrations/apply_strict_rls.sql
ALTER TABLE public.user_subscriptions FORCE ROW LEVEL SECURITY;

COMMIT;

-- ==========================================================
-- LAYER: INDEX
-- ==========================================================
BEGIN;
-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_audit_chain_sequence ON immutable_audit_chain(sequence_number);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_audit_chain_tamper ON immutable_audit_chain(tamper_detected) WHERE tamper_detected = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_ip_intel_cidr_gist ON adaptive_ip_intelligence USING GIST(ip_cidr);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_ip_intel_threat_score ON adaptive_ip_intelligence(threat_score DESC) WHERE threat_score > 60;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_ip_intel_auto_block ON adaptive_ip_intelligence(auto_block) WHERE auto_block = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_behavioral_fp_composite ON behavioral_fingerprint_engine(fingerprint_hash_composite);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_behavioral_fp_classification ON behavioral_fingerprint_engine(threat_classification) WHERE threat_classification NOT IN ('clean','unknown');

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_prompt_fortress_tenant_session ON prompt_cognitive_fortress(tenant_id, session_id, turn_number);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_prompt_fortress_risk ON prompt_cognitive_fortress(final_risk_score DESC) WHERE final_risk_score > 60;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_prompt_fortress_threat_class ON prompt_cognitive_fortress(dominant_threat_class) WHERE dominant_threat_class IS NOT NULL;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_prompt_fortress_action ON prompt_cognitive_fortress(action) WHERE action NOT IN ('pass','sanitize');

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_session_sovereignty_session ON session_cognitive_sovereignty(session_id, turn_number);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_session_trajectory ON session_cognitive_sovereignty(manipulation_trajectory) WHERE manipulation_trajectory != 'stable';

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_session_risk_velocity ON session_cognitive_sovereignty(risk_velocity DESC) WHERE risk_velocity > 0.1;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_canary_network_active ON canary_sovereignty_network(active, next_rotation_at) WHERE active = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_canary_forensics_severity ON canary_extraction_forensics(investigation_status) WHERE investigation_status = 'open';

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_crawler_pipeline_trust ON crawler_sovereign_pipeline(content_trust_score);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_crawler_quarantined ON crawler_sovereign_pipeline(quarantined) WHERE quarantined = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_domain_intel_tier ON domain_sovereign_intelligence(trust_tier);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_domain_poisoning ON domain_sovereign_intelligence(ai_poisoning_attempts DESC) WHERE ai_poisoning_attempts > 0;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_mesh_chain ON agent_cryptographic_mesh(ledger_sequence);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_mesh_unverified ON agent_cryptographic_mesh(signature_verified, timestamp) WHERE signature_verified = FALSE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_mesh_flagged ON agent_cryptographic_mesh(flagged) WHERE flagged = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_nonce_expires ON agent_nonce_sovereignty_vault(expires_at);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_nonce_reuse ON agent_nonce_sovereignty_vault(reuse_attempted) WHERE reuse_attempted = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_agent_behavioral_anomaly ON agent_behavioral_sovereignty(anomaly_detected, consecutive_anomaly_count) WHERE anomaly_detected = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_output_scanner_canary ON output_sovereignty_scanner(tenant_id) WHERE canary_tokens_detected != ARRAY[]::text;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_output_scanner_constitution ON output_sovereignty_scanner(constitutional_content_leak) WHERE constitutional_content_leak = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_output_scanner_risk ON output_sovereignty_scanner(total_risk_score DESC) WHERE total_risk_score > 70;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_deception_intelligence_ip ON deception_attacker_intelligence(attacker_ip);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_deception_campaign ON deception_attacker_intelligence(campaign_correlation_id);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_incident_command_severity ON sovereign_incident_command(severity, status);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_incident_command_campaign ON sovereign_incident_command(campaign_id);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_forensics_vault_incident ON sovereign_forensics_vault(incident_id);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_forensics_vault_legal_hold ON sovereign_forensics_vault(legal_hold) WHERE legal_hold = TRUE;

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_evolution_production ON signature_evolution_engine(deployed_to_production, triggered_at);

-- Source: schema-v5-p5c.sql
CREATE INDEX IF NOT EXISTS idx_kpi_window ON sovereign_security_intelligence(window_type, window_start);

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_exec_logs_agent
  ON agent_execution_logs(agent_name, created_at DESC);

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_brain_memory_type
  ON brain_memory(memory_type, is_validated);

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_learning_pending
  ON learning_candidates(filter_status, created_at)
  WHERE filter_status = 'pending';

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_intelligence_raw_status
  ON intelligence_raw(filter_status, collected_at DESC);

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_intelligence_verified_published
  ON intelligence_verified(published, created_at DESC);

-- Source: agents/schema.sql
CREATE INDEX IF NOT EXISTS idx_governance_decisions
  ON governance_decisions(decision_type, created_at DESC);

COMMIT;

-- ==========================================================
-- LAYER: FUNCTION
-- ==========================================================
BEGIN;
-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION fn_session_trust_decay() RETURNS void AS $$ BEGIN
  UPDATE session_cognitive_sovereignty
  SET
    trust_score_current = GREATEST(0, trust_score_current - 1),
    trust_delta = -1
  WHERE session_status IN ('continue','passive_monitor','active_monitor')
  AND trust_score_current > 0
  AND (NOW() - timestamp) > INTERVAL '5 minutes';
END;
 $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION fn_auto_quarantine_agent(
  p_agent_id UUID,
  p_reason TEXT,
  p_evidence JSONB,
  p_healing_strategy VARCHAR DEFAULT 'auto_isolate'
) RETURNS VARCHAR AS $$ DECLARE v_healing_id VARCHAR;
BEGIN
  UPDATE agent_sovereign_registry
  SET status = 'quarantined',
      current_risk_level = 'critical',
      status_reason = p_reason,
      status_changed_at = NOW()
  WHERE agent_id = p_agent_id;
  INSERT INTO agent_self_healing_log (
    agent_id, trigger_type, pre_healing_status, pre_healing_risk_level,
    healing_actions, healing_duration_ms, post_healing_status,
    post_healing_risk_level, healing_successful, requires_human_validation
  ) VALUES (
    p_agent_id, 'anomaly_threshold_breach', 'active', 'minimal',
    ARRAY[]::text[],
    0, 'quarantined', 'critical', TRUE, TRUE
  ) RETURNING healing_event_id INTO v_healing_id;
  RETURN v_healing_id;
END;
 $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION fn_rotate_canary_tokens() RETURNS INTEGER AS $$ DECLARE v_count INTEGER;
BEGIN
  UPDATE canary_sovereignty_network
  SET
    canary_generation = canary_generation + 1,
    last_rotated = NOW(),
    next_rotation_at = NOW() + (rotation_interval_hours || ' hours')::INTERVAL
  WHERE active = TRUE AND next_rotation_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO immutable_audit_chain (
    event_type, event_source, event_data, event_data_hash, cryptographic_signature
  ) VALUES (
    'canary_rotation', 'fn_rotate_canary_tokens',
    jsonb_build_object('tokens_rotated', v_count, 'timestamp', NOW()),
    encode(digest(v_count::TEXT, 'sha256'), 'hex'),
    encode(gen_random_bytes(64), 'hex')
  );
  RETURN v_count;
END;
 $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION fn_verify_audit_chain_integrity()
RETURNS TABLE(chain_valid BOOLEAN, first_violation BIGINT, total_records BIGINT) AS $$ DECLARE
  v_prev_hash VARCHAR(64) := NULL;
  v_violations INTEGER := 0;
  v_first_violation BIGINT := NULL;
  v_total BIGINT := 0;
BEGIN
  FOR rec IN
    SELECT sequence_number, current_record_hash, previous_record_hash
    FROM immutable_audit_chain ORDER BY sequence_number ASC
  LOOP
    v_total := v_total + 1;
    IF v_prev_hash IS NOT NULL AND rec.previous_record_hash != v_prev_hash THEN
      v_violations := v_violations + 1;
      IF v_first_violation IS NULL THEN v_first_violation := rec.sequence_number; END IF;
      UPDATE immutable_audit_chain SET tamper_detected = TRUE WHERE sequence_number = rec.sequence_number;
    END IF;
    v_prev_hash := rec.current_record_hash;
  END LOOP;
  RETURN QUERY SELECT (v_violations = 0), v_first_violation, v_total;
END;
 $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION fn_compute_sovereign_health_score() RETURNS INTEGER AS $$ DECLARE
  v_score INTEGER := 100;
  v_active_incidents INTEGER;
  v_unverified_agent_messages INTEGER;
  v_triggered_canaries INTEGER;
  v_anomalous_agents INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_active_incidents FROM sovereign_incident_command
  WHERE status NOT IN ('closed','false_positive') AND declared_at > NOW() - INTERVAL '1 hour';
  SELECT COUNT(*) INTO v_unverified_agent_messages FROM agent_cryptographic_mesh
    WHERE signature_verified = FALSE AND timestamp > NOW() - INTERVAL '10 minutes';
  SELECT COUNT(*) INTO v_triggered_canaries FROM canary_sovereignty_network
    WHERE last_triggered > NOW() - INTERVAL '1 hour';
  SELECT COUNT(*) INTO v_anomalous_agents FROM agent_sovereign_registry
    WHERE status IN ('quarantined','compromised','suspended');
  v_score := v_score - (v_active_incidents * 15);
  v_score := v_score - (v_unverified_agent_messages * 5);
  v_score := v_score - (v_triggered_canaries * 20);
  v_score := v_score - (v_anomalous_agents * 10);
  RETURN GREATEST(0, v_score);
END;
 $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION trg_fn_canary_breach_response() RETURNS TRIGGER AS $$ BEGIN
  IF NEW.canary_tokens_detected != ARRAY[]::text OR
     NEW.sentinel_tokens_detected != ARRAY[]::text OR
     NEW.constitutional_content_leak = TRUE THEN
    INSERT INTO sovereign_incident_command (
      severity, incident_type, initial_ioc,
      affected_tenants, kill_chain_stage_at_detection, auto_contained
    ) VALUES (
      'P1_critical', 'constitutional_content_extraction',
      'Canary/Sentinel token detected in model output',
      ARRAY[NEW.tenant_id]::text, 'exfiltration', FALSE
    );
    INSERT INTO immutable_audit_chain (
      event_type, event_source, event_data, event_data_hash, cryptographic_signature
    ) VALUES (
      'canary_breach_detected', 'output_sovereignty_scanner',
      jsonb_build_object('scan_id', NEW.scan_id, 'tenant_id', NEW.tenant_id, 'canary_tokens', NEW.canary_tokens_detected),
      encode(digest(NEW.scan_id::TEXT, 'sha256'), 'hex'),
      encode(gen_random_bytes(64), 'hex')
    );
  END IF;
  RETURN NEW;
END;
 $$ LANGUAGE plpgsql;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION trg_fn_agent_signature_response() RETURNS TRIGGER AS $$ BEGIN
  IF NEW.signature_verified = FALSE THEN
    PERFORM fn_auto_quarantine_agent(
      NEW.sender_agent_id, 'cryptographic_signature_failure',
      jsonb_build_object('message_id', NEW.message_id,
        'ledger_sequence', NEW.ledger_sequence, 'timestamp', NEW.timestamp),
      'auto_isolate'
    );
  END IF;
  IF NEW.reuse_attempted THEN
    INSERT INTO sovereign_incident_command (
      severity, incident_type, initial_ioc, affected_agents, auto_contained
    ) VALUES (
      'P2_high', 'nonce_replay_attack_detected',
      'Nonce reuse attempted on agent message channel',
      ARRAY[NEW.sender_agent_id]::text, TRUE
    );
  END IF;
  RETURN NEW;
END;
 $$ LANGUAGE plpgsql;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION trg_fn_audit_chain_immutability() RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'SOVEREIGN VIOLATION: Audit chain records are immutable. Modification attempt blocked and logged.';
  RETURN NULL;
END;
 $$ LANGUAGE plpgsql;

-- Source: schema-v5-p5c.sql
CREATE OR REPLACE FUNCTION trg_fn_session_risk_escalation() RETURNS TRIGGER AS $$ BEGIN
  IF NEW.session_cumulative_risk >= 0.85 THEN
    UPDATE session_cognitive_sovereignty
    SET session_recommendation = 'terminate'
    WHERE session_id = NEW.session_id AND turn_number = NEW.turn_number;
  END IF;
  RETURN NEW;
END;
 $$ LANGUAGE plpgsql;

-- Source: install-triggers.sql
CREATE OR REPLACE FUNCTION sovereign_veto_dual_lock()
RETURNS trigger AS $$ DECLARE
  override_sig TEXT;
  current_u TEXT;
BEGIN
  override_sig := current_setting('app.emergency_override', true);
  current_u := current_user;
  
  IF override_sig = '52bf740c8e88a7fcc871ca42a4e25421fb68d2a60c5a9836179f223478745f85' AND current_u = 'neondb_owner' THEN
    INSERT INTO sovereign_override_log (table_name, operation, performed_by)
    VALUES (TG_TABLE_NAME, TG_OP, current_u);
    RETURN OLD;
  ELSE
    RAISE EXCEPTION 'SOVEREIGN VETO: Dual-Lock failed. Break-Glass requires Owner role and valid key. (User: %)', current_u;
  END IF;
END;
 $$ LANGUAGE plpgsql;

COMMIT;

-- ==========================================================
-- LAYER: TRIGGER
-- ==========================================================
BEGIN;
-- Source: schema-v5-p5c.sql
CREATE TRIGGER trg_sovereign_canary_breach
  AFTER INSERT ON output_sovereignty_scanner
  FOR EACH ROW
  WHEN (NEW.canary_tokens_detected != ARRAY[]::text OR NEW.constitutional_content_leak = TRUE)
  EXECUTE FUNCTION trg_fn_canary_breach_response();

-- Source: schema-v5-p5c.sql
CREATE TRIGGER trg_agent_crypto_integrity
  AFTER INSERT ON agent_cryptographic_mesh
  FOR EACH ROW
  WHEN (NEW.signature_verified = FALSE OR NEW.chain_integrity_valid = FALSE)
  EXECUTE FUNCTION trg_fn_agent_signature_response();

-- Source: schema-v5-p5c.sql
CREATE TRIGGER trg_audit_chain_immutable
  BEFORE UPDATE OR DELETE ON immutable_audit_chain
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_audit_chain_immutability();

-- Source: schema-v5-p5c.sql
CREATE TRIGGER trg_session_risk_auto_terminate
  AFTER INSERT ON session_cognitive_sovereignty
  FOR EACH ROW
  WHEN (NEW.session_cumulative_risk >= 0.85)
  EXECUTE FUNCTION trg_fn_session_risk_escalation();

-- Source: install-triggers.sql
CREATE TRIGGER trg_sovereign_lock_immune_agent_trust BEFORE UPDATE OR DELETE ON immune_agent_trust FOR EACH ROW EXECUTE FUNCTION sovereign_veto_dual_lock();

-- Source: install-triggers.sql
CREATE TRIGGER trg_sovereign_lock_immune_audit_chain BEFORE UPDATE OR DELETE ON immune_audit_chain FOR EACH ROW EXECUTE FUNCTION sovereign_veto_dual_lock();

COMMIT;

-- ==========================================================
-- LAYER: POLICY
-- ==========================================================
BEGIN;
-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.ai_agent_logs;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.ai_agent_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.api_key_usage_logs;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.api_key_usage_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.audit_logs;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.audit_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.ba_accounts;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.ba_accounts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.ba_sessions;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.ba_sessions
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.billing_events;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.billing_events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.certificates;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.certificates
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.comment_votes;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.comment_votes
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.comments;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.comments
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.consultation_requests;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.consultation_requests
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.contact_messages;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.contact_messages
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.email_verifications;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.email_verifications
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.enrollments;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.enrollments
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.event_log;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.event_log
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.events;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.governance_contracts;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.governance_contracts
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.login_attempts;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.login_attempts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.media_usage;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.media_usage
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.model_follows;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.model_follows
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.model_reviews;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.model_reviews
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.nonce_registry;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.nonce_registry
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.notification_preferences;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.notification_preferences
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.notifications;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.notifications
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.page_views;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.page_views
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.password_resets;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.password_resets
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_cache_state;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.policy_cache_state
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_conflicts_log;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.policy_conflicts_log
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_documents;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.policy_documents
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.pricing_alerts;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.pricing_alerts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.prompt_ratings;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.prompt_ratings
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.prompt_saves;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.prompt_saves
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.quiz_attempts;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.quiz_attempts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.referral_codes;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.referral_codes
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.referral_events;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.referral_events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.routing_decisions;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.routing_decisions
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.search_queries;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.search_queries
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.tool_favorites;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.tool_favorites
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.tool_runs;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.tool_runs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_activity_summary;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.user_activity_summary
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_preferences;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.user_preferences
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_profiles;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.user_profiles
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Source: migrations/apply_strict_rls.sql
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_subscriptions;

-- Source: migrations/apply_strict_rls.sql
CREATE POLICY strict_isolation_policy ON public.user_subscriptions
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

COMMIT;

-- ==========================================================
-- LAYER: GRANT
-- ==========================================================
BEGIN;
-- Source: install-triggers.sql
REVOKE UPDATE, DELETE ON TABLE sovereign_override_log FROM app_user;

COMMIT;

-- ==========================================================
-- LAYER: OTHER
-- ==========================================================
BEGIN;
-- Source: migrations/fix_canary_tokens_protection.sql
DROP RULE IF EXISTS canary_tokens_no_delete ON public.canary_tokens;

-- Source: migrations/fix_canary_tokens_protection.sql
COMMIT;

-- Source: migrations/apply_strict_rls.sql
COMMIT;

-- Source: install-triggers.sql
DROP TRIGGER IF EXISTS trg_sovereign_lock_immune_agent_trust ON immune_agent_trust;

-- Source: install-triggers.sql
DROP TRIGGER IF EXISTS trg_sovereign_lock_immune_audit_chain ON immune_audit_chain;

COMMIT;

-- ==========================================================
-- VERIFICATION QUERIES
-- ==========================================================
SELECT 'TABLES' as type, count(*) as count FROM pg_tables WHERE schemaname = 'public'
UNION ALL
SELECT 'TRIGGERS' as type, count(*) as count FROM information_schema.triggers WHERE trigger_schema = 'public'
UNION ALL
SELECT 'POLICIES' as type, count(*) as count FROM pg_policies WHERE schemaname = 'public'
UNION ALL
SELECT 'FUNCTIONS' as type, count(*) as count FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
UNION ALL
SELECT 'INDEXES' as type, count(*) as count FROM pg_indexes WHERE schemaname = 'public';

-- ==========================================================
-- CRITICAL TABLE CHECK
-- ==========================================================
SELECT 'agent_registry' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'agent_registry' AND schemaname = 'public') as exists;
SELECT 'api_keys' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'api_keys' AND schemaname = 'public') as exists;
SELECT 'app_user' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'app_user' AND schemaname = 'public') as exists;
SELECT 'event_log' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'event_log' AND schemaname = 'public') as exists;
SELECT 'governance_audit_chain' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'governance_audit_chain' AND schemaname = 'public') as exists;
SELECT 'user_quota' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_quota' AND schemaname = 'public') as exists;
SELECT 'sovereign_schema_versions' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sovereign_schema_versions' AND schemaname = 'public') as exists;

-- ==========================================================
-- BOOTSTRAP COMPLETE
-- ==========================================================
