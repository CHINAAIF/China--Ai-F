CREATE TABLE crawler_security_pipeline (
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

CREATE TABLE domain_trust_registry (
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

CREATE TABLE agent_identity_registry (
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

CREATE TABLE agent_message_ledger (
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

CREATE TABLE agent_nonce_blacklist (
  nonce VARCHAR(64) PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE agent_behavioral_baselines (
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

CREATE TABLE agent_anomaly_events (
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
