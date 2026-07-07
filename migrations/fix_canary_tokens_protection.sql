-- =============================================================
-- Migration: Add Append-Only Protection to canary_tokens
-- =============================================================

BEGIN;

-- إزالة القواعد القديمة إن وجدت (لتجنب الخطأ) ثم إعادة إنشائها
DROP RULE IF EXISTS canary_tokens_no_update ON public.canary_tokens;
DROP RULE IF EXISTS canary_tokens_no_delete ON public.canary_tokens;

-- 1. Create Rule to prevent updates (silent block)
CREATE RULE canary_tokens_no_update 
AS ON UPDATE TO public.canary_tokens DO INSTEAD NOTHING;

-- 2. Create Rule to prevent deletes (silent block)
CREATE RULE canary_tokens_no_delete 
AS ON DELETE TO public.canary_tokens DO INSTEAD NOTHING;

COMMIT;

-- Verification
SELECT rulename 
FROM pg_rules 
WHERE schemaname = 'public' AND tablename = 'canary_tokens';
