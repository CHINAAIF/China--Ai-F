CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TABLE zero_trust_policy_engine (
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

CREATE TABLE continuous_auth_sessions (
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
