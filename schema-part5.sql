CREATE TABLE output_security_scan (
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

CREATE TABLE db_query_audit (
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

CREATE TABLE tenant_data_boundaries (
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

CREATE TABLE schema_change_log (
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

CREATE TABLE security_incidents (
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
