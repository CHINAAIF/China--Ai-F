-- Migration: Apply Strict RLS to sensitive tables
BEGIN;

-- Table: ai_agent_logs (Column: user_id)
ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.ai_agent_logs;
CREATE POLICY strict_isolation_policy ON public.ai_agent_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: api_key_usage_logs (Column: user_id)
ALTER TABLE public.api_key_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_usage_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.api_key_usage_logs;
CREATE POLICY strict_isolation_policy ON public.api_key_usage_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: audit_logs (Column: user_id)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.audit_logs;
CREATE POLICY strict_isolation_policy ON public.audit_logs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: ba_accounts (Column: user_id)
ALTER TABLE public.ba_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.ba_accounts;
CREATE POLICY strict_isolation_policy ON public.ba_accounts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: ba_sessions (Column: user_id)
ALTER TABLE public.ba_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.ba_sessions;
CREATE POLICY strict_isolation_policy ON public.ba_sessions
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: billing_events (Column: user_id)
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.billing_events;
CREATE POLICY strict_isolation_policy ON public.billing_events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: certificates (Column: user_id)
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.certificates;
CREATE POLICY strict_isolation_policy ON public.certificates
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: comment_votes (Column: user_id)
ALTER TABLE public.comment_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_votes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.comment_votes;
CREATE POLICY strict_isolation_policy ON public.comment_votes
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: comments (Column: user_id)
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.comments;
CREATE POLICY strict_isolation_policy ON public.comments
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: consultation_requests (Column: user_id)
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.consultation_requests;
CREATE POLICY strict_isolation_policy ON public.consultation_requests
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: contact_messages (Column: user_id)
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.contact_messages;
CREATE POLICY strict_isolation_policy ON public.contact_messages
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: email_verifications (Column: user_id)
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.email_verifications;
CREATE POLICY strict_isolation_policy ON public.email_verifications
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: enrollments (Column: user_id)
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.enrollments;
CREATE POLICY strict_isolation_policy ON public.enrollments
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: event_log (Column: customer_id)
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.event_log;
CREATE POLICY strict_isolation_policy ON public.event_log
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: events (Column: user_id)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.events;
CREATE POLICY strict_isolation_policy ON public.events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: governance_contracts (Column: customer_id)
ALTER TABLE public.governance_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.governance_contracts;
CREATE POLICY strict_isolation_policy ON public.governance_contracts
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: login_attempts (Column: user_id)
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.login_attempts;
CREATE POLICY strict_isolation_policy ON public.login_attempts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: media_usage (Column: user_id)
ALTER TABLE public.media_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.media_usage;
CREATE POLICY strict_isolation_policy ON public.media_usage
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: model_follows (Column: user_id)
ALTER TABLE public.model_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_follows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.model_follows;
CREATE POLICY strict_isolation_policy ON public.model_follows
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: model_reviews (Column: user_id)
ALTER TABLE public.model_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.model_reviews;
CREATE POLICY strict_isolation_policy ON public.model_reviews
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: nonce_registry (Column: customer_id)
ALTER TABLE public.nonce_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nonce_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.nonce_registry;
CREATE POLICY strict_isolation_policy ON public.nonce_registry
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: notification_preferences (Column: user_id)
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.notification_preferences;
CREATE POLICY strict_isolation_policy ON public.notification_preferences
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: notifications (Column: user_id)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.notifications;
CREATE POLICY strict_isolation_policy ON public.notifications
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: page_views (Column: user_id)
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.page_views;
CREATE POLICY strict_isolation_policy ON public.page_views
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: password_resets (Column: user_id)
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.password_resets;
CREATE POLICY strict_isolation_policy ON public.password_resets
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: policy_cache_state (Column: customer_id)
ALTER TABLE public.policy_cache_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_cache_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_cache_state;
CREATE POLICY strict_isolation_policy ON public.policy_cache_state
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: policy_conflicts_log (Column: customer_id)
ALTER TABLE public.policy_conflicts_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_conflicts_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_conflicts_log;
CREATE POLICY strict_isolation_policy ON public.policy_conflicts_log
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: policy_documents (Column: customer_id)
ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.policy_documents;
CREATE POLICY strict_isolation_policy ON public.policy_documents
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: pricing_alerts (Column: user_id)
ALTER TABLE public.pricing_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.pricing_alerts;
CREATE POLICY strict_isolation_policy ON public.pricing_alerts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: prompt_ratings (Column: user_id)
ALTER TABLE public.prompt_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_ratings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.prompt_ratings;
CREATE POLICY strict_isolation_policy ON public.prompt_ratings
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: prompt_saves (Column: user_id)
ALTER TABLE public.prompt_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_saves FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.prompt_saves;
CREATE POLICY strict_isolation_policy ON public.prompt_saves
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: quiz_attempts (Column: user_id)
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.quiz_attempts;
CREATE POLICY strict_isolation_policy ON public.quiz_attempts
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: referral_codes (Column: user_id)
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.referral_codes;
CREATE POLICY strict_isolation_policy ON public.referral_codes
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: referral_events (Column: user_id)
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.referral_events;
CREATE POLICY strict_isolation_policy ON public.referral_events
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: routing_decisions (Column: customer_id)
ALTER TABLE public.routing_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.routing_decisions;
CREATE POLICY strict_isolation_policy ON public.routing_decisions
  FOR ALL
  USING (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (customer_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: search_queries (Column: user_id)
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.search_queries;
CREATE POLICY strict_isolation_policy ON public.search_queries
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: tool_favorites (Column: user_id)
ALTER TABLE public.tool_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_favorites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.tool_favorites;
CREATE POLICY strict_isolation_policy ON public.tool_favorites
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: tool_runs (Column: user_id)
ALTER TABLE public.tool_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.tool_runs;
CREATE POLICY strict_isolation_policy ON public.tool_runs
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: user_activity_summary (Column: user_id)
ALTER TABLE public.user_activity_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity_summary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_activity_summary;
CREATE POLICY strict_isolation_policy ON public.user_activity_summary
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: user_preferences (Column: user_id)
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_preferences;
CREATE POLICY strict_isolation_policy ON public.user_preferences
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: user_profiles (Column: user_id)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_profiles;
CREATE POLICY strict_isolation_policy ON public.user_profiles
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

-- Table: user_subscriptions (Column: user_id)
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strict_isolation_policy ON public.user_subscriptions;
CREATE POLICY strict_isolation_policy ON public.user_subscriptions
  FOR ALL
  USING (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL)
  WITH CHECK (user_id::text = current_setting('app.current_id', true) AND current_setting('app.current_id', true) IS NOT NULL);

COMMIT;
