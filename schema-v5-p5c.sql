CREATE INDEX idx_audit_chain_sequence ON immutable_audit_chain(sequence_number);
CREATE INDEX idx_audit_chain_tamper ON immutable_audit_chain(tamper_detected) WHERE tamper_detected = TRUE;
CREATE INDEX idx_ip_intel_cidr_gist ON adaptive_ip_intelligence USING GIST(ip_cidr);
CREATE INDEX idx_ip_intel_threat_score ON adaptive_ip_intelligence(threat_score DESC) WHERE threat_score > 60;
CREATE INDEX idx_ip_intel_auto_block ON adaptive_ip_intelligence(auto_block) WHERE auto_block = TRUE;
CREATE INDEX idx_behavioral_fp_composite ON behavioral_fingerprint_engine(fingerprint_hash_composite);
CREATE INDEX idx_behavioral_fp_classification ON behavioral_fingerprint_engine(threat_classification) WHERE threat_classification NOT IN ('clean','unknown');
CREATE INDEX idx_prompt_fortress_tenant_session ON prompt_cognitive_fortress(tenant_id, session_id, turn_number);
CREATE INDEX idx_prompt_fortress_risk ON prompt_cognitive_fortress(final_risk_score DESC) WHERE final_risk_score > 60;
CREATE INDEX idx_prompt_fortress_threat_class ON prompt_cognitive_fortress(dominant_threat_class) WHERE dominant_threat_class IS NOT NULL;
CREATE INDEX idx_prompt_fortress_action ON prompt_cognitive_fortress(action) WHERE action NOT IN ('pass','sanitize');
CREATE INDEX idx_session_sovereignty_session ON session_cognitive_sovereignty(session_id, turn_number);
CREATE INDEX idx_session_trajectory ON session_cognitive_sovereignty(manipulation_trajectory) WHERE manipulation_trajectory != 'stable';
CREATE INDEX idx_session_risk_velocity ON session_cognitive_sovereignty(risk_velocity DESC) WHERE risk_velocity > 0.1;
CREATE INDEX idx_canary_network_active ON canary_sovereignty_network(active, next_rotation_at) WHERE active = TRUE;
CREATE INDEX idx_canary_forensics_severity ON canary_extraction_forensics(investigation_status) WHERE investigation_status = 'open';
CREATE INDEX idx_crawler_pipeline_trust ON crawler_sovereign_pipeline(content_trust_score);
CREATE INDEX idx_crawler_quarantined ON crawler_sovereign_pipeline(quarantined) WHERE quarantined = TRUE;
CREATE INDEX idx_domain_intel_tier ON domain_sovereign_intelligence(trust_tier);
CREATE INDEX idx_domain_poisoning ON domain_sovereign_intelligence(ai_poisoning_attempts DESC) WHERE ai_poisoning_attempts > 0;
CREATE INDEX idx_agent_mesh_chain ON agent_cryptographic_mesh(ledger_sequence);
CREATE INDEX idx_agent_mesh_unverified ON agent_cryptographic_mesh(signature_verified, timestamp) WHERE signature_verified = FALSE;
CREATE INDEX idx_agent_mesh_flagged ON agent_cryptographic_mesh(flagged) WHERE flagged = TRUE;
CREATE INDEX idx_agent_nonce_expires ON agent_nonce_sovereignty_vault(expires_at);
CREATE INDEX idx_agent_nonce_reuse ON agent_nonce_sovereignty_vault(reuse_attempted) WHERE reuse_attempted = TRUE;
CREATE INDEX idx_agent_behavioral_anomaly ON agent_behavioral_sovereignty(anomaly_detected, consecutive_anomaly_count) WHERE anomaly_detected = TRUE;
CREATE INDEX idx_output_scanner_canary ON output_sovereignty_scanner(tenant_id) WHERE canary_tokens_detected != ARRAY[]::text;
CREATE INDEX idx_output_scanner_constitution ON output_sovereignty_scanner(constitutional_content_leak) WHERE constitutional_content_leak = TRUE;
CREATE INDEX idx_output_scanner_risk ON output_sovereignty_scanner(total_risk_score DESC) WHERE total_risk_score > 70;
CREATE INDEX idx_deception_intelligence_ip ON deception_attacker_intelligence(attacker_ip);
CREATE INDEX idx_deception_campaign ON deception_attacker_intelligence(campaign_correlation_id);
CREATE INDEX idx_incident_command_severity ON sovereign_incident_command(severity, status);
CREATE INDEX idx_incident_command_campaign ON sovereign_incident_command(campaign_id);
CREATE INDEX idx_forensics_vault_incident ON sovereign_forensics_vault(incident_id);
CREATE INDEX idx_forensics_vault_legal_hold ON sovereign_forensics_vault(legal_hold) WHERE legal_hold = TRUE;
CREATE INDEX idx_evolution_production ON signature_evolution_engine(deployed_to_production, triggered_at);
CREATE INDEX idx_kpi_window ON sovereign_security_intelligence(window_type, window_start);

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

CREATE TRIGGER trg_sovereign_canary_breach
  AFTER INSERT ON output_sovereignty_scanner
  FOR EACH ROW
  WHEN (NEW.canary_tokens_detected != ARRAY[]::text OR NEW.constitutional_content_leak = TRUE)
  EXECUTE FUNCTION trg_fn_canary_breach_response();

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

CREATE TRIGGER trg_agent_crypto_integrity
  AFTER INSERT ON agent_cryptographic_mesh
  FOR EACH ROW
  WHEN (NEW.signature_verified = FALSE OR NEW.chain_integrity_valid = FALSE)
  EXECUTE FUNCTION trg_fn_agent_signature_response();

CREATE OR REPLACE FUNCTION trg_fn_audit_chain_immutability() RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'SOVEREIGN VIOLATION: Audit chain records are immutable. Modification attempt blocked and logged.';
  RETURN NULL;
END;
 $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_chain_immutable
  BEFORE UPDATE OR DELETE ON immutable_audit_chain
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_audit_chain_immutability();

CREATE OR REPLACE FUNCTION trg_fn_session_risk_escalation() RETURNS TRIGGER AS $$ BEGIN
  IF NEW.session_cumulative_risk >= 0.85 THEN
    UPDATE session_cognitive_sovereignty
    SET session_recommendation = 'terminate'
    WHERE session_id = NEW.session_id AND turn_number = NEW.turn_number;
  END IF;
  RETURN NEW;
END;
 $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_risk_auto_terminate
  AFTER INSERT ON session_cognitive_sovereignty
  FOR EACH ROW
  WHEN (NEW.session_cumulative_risk >= 0.85)
  EXECUTE FUNCTION trg_fn_session_risk_escalation();
