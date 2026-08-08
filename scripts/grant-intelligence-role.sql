-- TRUNKIA: عزل صلاحيات طبقة الاستخبارات
-- يتم تنفيذه مرة واحدة على قاعدة بيانات Neon

-- إنشاء الدور الجديد
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agent_intelligence_role') THEN
    CREATE ROLE agent_intelligence_role WITH LOGIN PASSWORD 'ضع_كلمة_سر_قوية_هنا';
  END IF;
END
$$;

-- منح الصلاحيات على الجداول المحددة فقط
GRANT SELECT, INSERT, UPDATE ON 
  agent_circuit_breaker,
  agent_execution_logs,
  agent_heartbeat,
  agent_registry,
  benchmark_definitions,
  brain_knowledge_gaps,
  brain_working_memory,
  chinese_ai_models,
  intelligence_raw,
  intelligence_sources,
  learning_candidates,
  model_benchmarks,
  model_pricing_tiers,
  model_timeline,
  models,
  source_reputation,
  temporal_intelligence,
  vendors
TO agent_intelligence_role;

-- منع أي صلاحيات أخرى
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_intelligence_role;
