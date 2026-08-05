import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging' });

const sig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update('EMERGENCY_OVERRIDE').digest('hex');

const sql = `-- TRUNKIA Sovereign Dual-Lock Triggers
CREATE TABLE IF NOT EXISTS sovereign_override_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT,
  operation TEXT,
  performed_by TEXT,
  performed_at TIMESTAMP DEFAULT NOW()
);
REVOKE UPDATE, DELETE ON TABLE sovereign_override_log FROM app_user;

CREATE OR REPLACE FUNCTION sovereign_veto_dual_lock()
RETURNS trigger AS $$ DECLARE
  override_sig TEXT;
  current_u TEXT;
BEGIN
  override_sig := current_setting('app.emergency_override', true);
  current_u := current_user;
  
  IF override_sig = '${sig}' AND current_u = 'neondb_owner' THEN
    INSERT INTO sovereign_override_log (table_name, operation, performed_by)
    VALUES (TG_TABLE_NAME, TG_OP, current_u);
    RETURN OLD;
  ELSE
    RAISE EXCEPTION 'SOVEREIGN VETO: Dual-Lock failed. Break-Glass requires Owner role and valid key. (User: %)', current_u;
  END IF;
END;
 $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sovereign_lock_immune_agent_trust ON immune_agent_trust;
CREATE TRIGGER trg_sovereign_lock_immune_agent_trust BEFORE UPDATE OR DELETE ON immune_agent_trust FOR EACH ROW EXECUTE FUNCTION sovereign_veto_dual_lock();

DROP TRIGGER IF EXISTS trg_sovereign_lock_immune_audit_chain ON immune_audit_chain;
CREATE TRIGGER trg_sovereign_lock_immune_audit_chain BEFORE UPDATE OR DELETE ON immune_audit_chain FOR EACH ROW EXECUTE FUNCTION sovereign_veto_dual_lock();
`;

fs.writeFileSync('install-triggers.sql', sql.trim(), 'utf8');
console.log('✅ Clean SQL file generated: install-triggers.sql');
console.log('Please open this file, copy its contents, and paste them into the Neon SQL Editor, then click Run.');
