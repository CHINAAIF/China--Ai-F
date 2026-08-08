-- ==========================================
-- CHINAAIF AGENT SYSTEM SCHEMA
-- ==========================================

-- طبقة الوكلاء الأساسية
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(100) UNIQUE NOT NULL,
  agent_layer VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active','paused','disabled')),
  model_provider VARCHAR(50) DEFAULT 'groq',
  last_run_at TIMESTAMP NULL,
  run_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  avg_duration_ms INTEGER DEFAULT 0,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now()
);

-- قائمة مهام الوكلاء
CREATE TABLE IF NOT EXISTS agent_task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(100) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  priority SMALLINT DEFAULT 5,
  payload JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','canceled')),
  attempts SMALLINT DEFAULT 0,
  max_attempts SMALLINT DEFAULT 3,
  scheduled_at TIMESTAMP DEFAULT now(),
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  error_log TEXT NULL,
  result JSONB NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- سجلات تنفيذ الوكلاء
CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name VARCHAR(100) NOT NULL,
  task_id UUID NULL,
  action VARCHAR(100) NOT NULL,
  model_used VARCHAR(50) NULL,
  input JSONB NULL,
  output JSONB NULL,
  confidence SMALLINT NULL CHECK (confidence BETWEEN 0 AND 100),
  tokens_used INTEGER NULL,
  duration_ms INTEGER NULL,
  status VARCHAR(20) NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- ==========================================
-- العقل المركزي
-- ==========================================

CREATE TABLE IF NOT EXISTS brain_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_type VARCHAR(50) NOT NULL
    CHECK (memory_type IN (
      'pricing_pattern','vendor_behavior','market_signal',
      'content_insight','agent_performance','security_pattern',
      'user_behavior','prediction_result'
    )),
  context JSONB NOT NULL,
  decision_made TEXT NOT NULL,
  outcome TEXT NULL,
  confidence_delta SMALLINT NULL,
  learned_pattern JSONB DEFAULT '{}',
  is_validated BOOLEAN DEFAULT false,
  validated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT now()
);

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

-- ==========================================
-- طبقة التعلم المصفى
-- ==========================================

CREATE TABLE IF NOT EXISTS learning_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent VARCHAR(100) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  raw_data JSONB NOT NULL,
  filter_score SMALLINT NULL CHECK (filter_score BETWEEN 0 AND 100),
  filter_status VARCHAR(20) DEFAULT 'pending'
    CHECK (filter_status IN ('pending','approved','rejected','disputed')),
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT now()
);

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

-- ==========================================
-- طبقة الحوكمة
-- ==========================================

CREATE TABLE IF NOT EXISTS governance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_type VARCHAR(50) NOT NULL,
  initiated_by VARCHAR(100) NOT NULL,
  agents_consulted TEXT[] DEFAULT '{}',
  models_consulted TEXT[] DEFAULT '{}',
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  final_decision VARCHAR(20) NOT NULL
    CHECK (final_decision IN ('approved','rejected','escalated')),
  escalated_to VARCHAR(50) NULL,
  reasoning TEXT NULL,
  execution_result JSONB NULL,
  created_at TIMESTAMP DEFAULT now()
);

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

-- ==========================================
-- طبقة الاستخبارات
-- ==========================================

CREATE TABLE IF NOT EXISTS intelligence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL
    CHECK (source_type IN (
      'social_media','official','research','news',
      'patent','investment','community','government'
    )),
  source_url TEXT NULL,
  language VARCHAR(10) DEFAULT 'zh',
  reliability_score SMALLINT DEFAULT 50
    CHECK (reliability_score BETWEEN 0 AND 100),
  is_chinese_source BOOLEAN DEFAULT false,
  last_crawled_at TIMESTAMP NULL,
  crawl_frequency_hours INTEGER DEFAULT 6,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

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

-- ==========================================
-- الفهارس الحرجة
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_task_queue_pending
  ON agent_task_queue(priority DESC, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_exec_logs_agent
  ON agent_execution_logs(agent_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_memory_type
  ON brain_memory(memory_type, is_validated);

CREATE INDEX IF NOT EXISTS idx_learning_pending
  ON learning_candidates(filter_status, created_at)
  WHERE filter_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_intelligence_raw_status
  ON intelligence_raw(filter_status, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_verified_published
  ON intelligence_verified(published, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_governance_decisions
  ON governance_decisions(decision_type, created_at DESC);

