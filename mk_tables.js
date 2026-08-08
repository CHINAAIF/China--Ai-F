import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function run() {
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS data_sensitivity_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), rule_name VARCHAR(100) NOT NULL UNIQUE, category VARCHAR(50) NOT NULL CHECK (category IN ('pii','financial','health','government','proprietary','public')), pattern TEXT NOT NULL, risk_level SMALLINT NOT NULL CHECK (risk_level BETWEEN 1 AND 10), action VARCHAR(20) NOT NULL CHECK (action IN ('block','mask','flag','allow')), description TEXT, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW())");
    console.log('OK: data_sensitivity_rules');

    await pool.query("CREATE TABLE IF NOT EXISTS compliance_checks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), check_type VARCHAR(50) NOT NULL CHECK (check_type IN ('gdpr','hipaa','soc2','pci_dss','custom')), agent_id VARCHAR(100), request_hash VARCHAR(64), input_scan JSONB, output_scan JSONB, violations JSONB, risk_score SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100), passed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW())");
    console.log('OK: compliance_checks');

    await pool.query("CREATE TABLE IF NOT EXISTS privacy_scores (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agent_id VARCHAR(100), request_hash VARCHAR(64), data_sensitivity_score SMALLINT NOT NULL CHECK (data_sensitivity_score BETWEEN 0 AND 100), pii_detected_count INTEGER NOT NULL DEFAULT 0, pii_types JSONB, masking_applied BOOLEAN NOT NULL DEFAULT false, overall_privacy_risk VARCHAR(10) NOT NULL CHECK (overall_privacy_risk IN ('low','medium','high','critical')), recommendation TEXT, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW())");
    console.log('OK: privacy_scores');

    await pool.query("CREATE TABLE IF NOT EXISTS incident_reports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), incident_type VARCHAR(50) NOT NULL CHECK (incident_type IN ('data_leak','unauthorized_access','compliance_violation','pii_exposure','policy_breach','anomaly')), severity VARCHAR(10) NOT NULL CHECK (severity IN ('low','medium','high','critical')), agent_id VARCHAR(100), request_hash VARCHAR(64), description TEXT, evidence JSONB, resolution_status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open','investigating','resolved','dismissed')), resolved_at TIMESTAMP WITHOUT TIME ZONE, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW())");
    console.log('OK: incident_reports');

    var rules = [
      ['email_pii','pii','[\\w.-]+@[\\w.-]+\\.\\w{2,}',8,'mask','Email addresses'],
      ['phone_pii','pii','\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b',7,'mask','Phone numbers'],
      ['credit_card_financial','financial','\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b',10,'block','Credit card numbers'],
      ['national_id_pii','pii','\\b(?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\d{10,12}\\b',9,'block','National IDs'],
      ['ip_address','pii','\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b',5,'mask','IP addresses'],
      ['ssn_pii','pii','\\b\\d{3}-\\d{2}-\\d{4}\\b',10,'block','SSN patterns'],
      ['bank_account_financial','financial','\\b[A-Z]{2}\\d{2}[A-Z0-9]{4,30}\\b',9,'block','IBAN accounts'],
      ['health_keywords','health','\\b(?:diagnosis|medical|patient|disease|symptom|treatment|medication)\\b',6,'flag','Health keywords'],
      ['gov_classified','government','\\b(?:classified|top.secret|confidential|clearance)\\b',10,'block','Gov classified'],
      ['api_key_pattern','proprietary','\\b(?:sk-|api_key|secret)[\\w-]{20,}\\b',9,'block','API keys']
    ];
    for (var i = 0; i < rules.length; i++) {
      try { await pool.query('INSERT INTO data_sensitivity_rules (rule_name,category,pattern,risk_level,action,description) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (rule_name) DO NOTHING', rules[i]); } catch(e) {}
    }
    console.log('OK: seeded ' + rules.length + ' rules');

    var c1 = await pool.query("SELECT count(*) as c FROM data_sensitivity_rules");
    console.log('Verify: ' + c1.rows[0].c + ' rules in DB');
  } catch(e) { console.error('ERR: ' + e.message); }
  await pool.end();
}
run();
