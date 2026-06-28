CREATE TABLE ip_threat_intelligence (
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

CREATE TABLE behavioral_fingerprints (
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

CREATE TABLE rate_limit_tiers (
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

CREATE TABLE rate_limit_events (
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

CREATE TABLE distributed_attack_patterns (
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
