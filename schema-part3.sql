CREATE TABLE prompt_injection_signatures (
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

CREATE TABLE prompt_preprocessing_log (
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

CREATE TABLE canary_token_registry (
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

CREATE TABLE canary_trigger_events (
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

CREATE TABLE session_security_timeline (
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
