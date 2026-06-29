import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function run() {
  // Drop old constraint and add new one with 'warn'
  try {
    await pool.query("ALTER TABLE data_sensitivity_rules DROP CONSTRAINT data_sensitivity_rules_action_check");
    console.log('OK: dropped old action check');
  } catch(e) { console.log('drop: ' + e.message); }

  try {
    await pool.query("ALTER TABLE data_sensitivity_rules ADD CONSTRAINT data_sensitivity_rules_action_check CHECK (action IN ('block','mask','flag','allow','warn'))");
    console.log('OK: added new action check with warn');
  } catch(e) { console.log('add: ' + e.message); }

  // Also fix compliance_checks if needed
  try {
    await pool.query("ALTER TABLE compliance_checks DROP CONSTRAINT compliance_checks_check_type_check");
    await pool.query("ALTER TABLE compliance_checks ADD CONSTRAINT compliance_checks_check_type_check CHECK (check_type IN ('gdpr','hipaa','soc2','pci_dss','custom','pii_scan','attack_scan'))");
    console.log('OK: fixed compliance_checks check_type');
  } catch(e) {}

  await pool.end();
}
run();
