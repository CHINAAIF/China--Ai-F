import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { tableExists } from '../utils/executor.js';

var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').substring(0, 64);
}

class SafetyComplianceLayer {
  constructor() {
    this.name = 'safety_compliance_layer';
    this.layer = 'governance';
    this.status = 'active';
    this.rulesCache = null;
    this.rulesCacheTime = 0;
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      var tables = ['data_sensitivity_rules', 'compliance_checks', 'privacy_scores', 'incident_reports'];
      for (var i = 0; i < tables.length; i++) {
        var exists = await tableExists(tables[i]);
        if (!exists) { this.status = 'missing_table:' + tables[i]; return false; }
      }
      return true;
    } catch(e) { this.status = 'db_error'; return false; }
  }

  async getRules() {
    var now = Date.now();
    if (this.rulesCache && (now - this.rulesCacheTime) < 60000) return this.rulesCache;
    try {
      var r = await pool.query('SELECT rule_name, category, pattern, risk_level, action, description FROM data_sensitivity_rules WHERE active=true ORDER BY risk_level DESC');
      this.rulesCache = r.rows;
      this.rulesCacheTime = now;
      return r.rows;
    } catch(e) { return []; }
  }

  async scanText(text, agentId) {
    var rules = await this.getRules();
    var findings = [];
    var totalRiskScore = 0;
    var maskedText = text;
    var piiTypes = {};
    var blocks = [];
    var warnings = [];
    var flags = [];

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      try {
        var regex = new RegExp(rule.pattern, 'gi');
        var matches = text.match(regex);
        if (matches && matches.length > 0) {
          var finding = {
            rule_name: rule.rule_name,
            category: rule.category,
            action: rule.action,
            risk_level: rule.risk_level,
            count: matches.length,
            description: rule.description,
            samples: matches.map(function(m) { return m.length > 20 ? m.substring(0, 20) + '...' : m; })
          };
          findings.push(finding);
          totalRiskScore += rule.risk_level * matches.length;
          if (!piiTypes[rule.category]) piiTypes[rule.category] = [];
          piiTypes[rule.category].push(rule.rule_name + '(' + matches.length + ')');

          if (rule.action === 'block') blocks.push(finding);
          else if (rule.action === 'warn') warnings.push(finding);
          else if (rule.action === 'flag') flags.push(finding);

          // Mask using DB regex directly
          try {
            maskedText = maskedText.replace(regex, function(match) {
              if (match.length <= 2) return '**';
              return match[0] + '*'.repeat(match.length - 2) + match[match.length - 1];
            });
          } catch(erm) {}
        }
      } catch(_) {}
    }

    var normalizedRisk = Math.min(100, Math.round(totalRiskScore * 1.5));

    return {
      findings: findings,
      total_risk_score: normalizedRisk,
      pii_types: piiTypes,
      pii_count: findings.reduce(function(a, f) { return a + f.count; }, 0),
      masked_text: maskedText,
      blocks: blocks,
      warnings: warnings,
      flags: flags,
      has_blocks: blocks.length > 0,
      has_warnings: warnings.length > 0,
      risk_level: normalizedRisk >= 80 ? 'critical' : normalizedRisk >= 50 ? 'high' : normalizedRisk >= 25 ? 'medium' : 'low'
    };
  }

  // Build user-friendly consent message
  buildConsentMessage(scan) {
    var lines = [];
    lines.push('=== تنبيه أمني ===');
    lines.push('اكتشف النظام معلومات حساسة في طلبك:');

    if (scan.blocks.length > 0) {
      lines.push('');
      lines.push('[ممنوع - لا يمكن المتابعة]:');
      for (var i = 0; i < scan.blocks.length; i++) {
        var b = scan.blocks[i];
        lines.push('  - ' + b.description + ' (' + b.count + ' مطابقة) — مستوى الخطورة: ' + b.risk_level + '/10');
      }
      lines.push('');
      lines.push('السبب: هذه البيانات تشكل خطراً أمنياً مباشراً (اختراق/مفاتيح/أسلحة).');
      lines.push('الإجراء: الطلب محظور تماماً لحمايتك وحماية النظام.');
    }

    if (scan.warnings.length > 0) {
      lines.push('');
      lines.push('[تحذير - يتطلب موافقتك]:');
      for (var j = 0; j < scan.warnings.length; j++) {
        var w = scan.warnings[j];
        lines.push('  - ' + w.description + ' (' + w.count + ' مطابقة) — مستوى الخطورة: ' + w.risk_level + '/10');
      }
      lines.push('');
      lines.push('السبب: هذه بيانات شخصية أو حساسة لكنها قد تكون مشروعة.');
      lines.push('الإجراء: سيتم إخفاؤها قبل المعالجة. وافق إذا كنت تعرف المخاطر.');
    }

    if (scan.flags.length > 0) {
      lines.push('');
      lines.push('[ملاحظة - تم تسجيله]:');
      for (var k = 0; k < scan.flags.length; k++) {
        var f = scan.flags[k];
        lines.push('  - ' + f.description + ' (' + f.count + ' مطابقة)');
      }
    }

    lines.push('');
    lines.push('مستوى الخطر الإجمالي: ' + scan.risk_level + ' (' + scan.total_risk_score + '/100)');

    return lines.join('\n');
  }

  async gdprCheck(inputText, outputText, agentId) {
    var inputScan = await this.scanText(inputText, agentId);
    var outputScan = await this.scanText(outputText || '', agentId);
    var violations = [];
    var passed = true;

    if (outputScan.pii_count > 0) {
      violations.push({ rule: 'gdpr_data_minimization', severity: 'high', detail: 'PII في مخرجات النموذج' });
      passed = false;
    }
    if (inputScan.has_blocks) {
      violations.push({ rule: 'gdpr_data_protection', severity: 'critical', detail: 'بيانات محظورة في المدخلات' });
      passed = false;
    }
    if (inputScan.findings.some(function(f) { return f.category === 'government'; })) {
      violations.push({ rule: 'gdpr_cross_border', severity: 'high', detail: 'بيانات حكومية' });
      passed = false;
    }
    if (inputScan.findings.some(function(f) { return f.category === 'health'; })) {
      violations.push({ rule: 'gdpr_special_category', severity: 'high', detail: 'بيانات صحية خاصة' });
      passed = false;
    }

    var riskScore = passed ? 0 : Math.min(100, violations.length * 25 + inputScan.total_risk_score / 4);

    try {
      var evtHash = hashText(JSON.stringify(violations));
      await pool.query(
        'INSERT INTO compliance_checks (check_type,agent_id,request_hash,input_scan,output_scan,violations,risk_score,passed,created_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,NOW())',
        ['gdpr', agentId, evtHash,
          { findings: inputScan.findings.length, risk: inputScan.total_risk_score, blocks: inputScan.blocks.length, warnings: inputScan.warnings.length },
          { findings: outputScan.findings.length, risk: outputScan.total_risk_score },
          violations, riskScore, passed
        ]
      );
    } catch(_) {}

    return { check_type: 'gdpr', passed: passed, risk_score: riskScore, violations: violations,
      input_summary: { pii: inputScan.pii_count, risk: inputScan.total_risk_score, blocked: inputScan.has_blocks, warned: inputScan.has_warnings },
      output_summary: { pii: outputScan.pii_count } };
  }

  async assessPrivacy(inputText, agentId) {
    var scan = await this.scanText(inputText, agentId);
    var recommendation = '';
    if (scan.has_blocks) recommendation = 'BLOCK: بيانات خطيرة — محظور تماماً';
    else if (scan.has_warnings) recommendation = 'CONSENT: بيانات حساسة — يحتاج موافقة بعد التحذير';
    else if (scan.flags.length > 0) recommendation = 'NOTED: تم تسجيل الملاحظات — مسموح';
    else recommendation = 'ALLOW: لا مخاوف أمنية';

    try {
      var evtHash = hashText(JSON.stringify(scan.pii_types));
      await pool.query(
        'INSERT INTO privacy_scores (agent_id,request_hash,data_sensitivity_score,pii_detected_count,pii_types,masking_applied,overall_privacy_risk,recommendation,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW())',
        [agentId, evtHash, scan.total_risk_score, scan.pii_count, scan.pii_types, scan.pii_count > 0, scan.risk_level, recommendation]
      );
    } catch(_) {}

    if (scan.risk_level === 'critical') {
      await this.createIncident('pii_exposure', 'critical', agentId, null,
        'كشف بيانات حرجة: ' + JSON.stringify(scan.pii_types),
        { findings: scan.findings.map(function(f) { return f.rule_name + ':' + f.action; }) });
    }

    return {
      risk_level: scan.risk_level,
      sensitivity_score: scan.total_risk_score,
      pii_detected: scan.pii_count,
      pii_types: scan.pii_types,
      masked_text: scan.masked_text,
      should_block: scan.has_blocks,
      needs_consent: scan.has_warnings && !scan.has_blocks,
      consent_message: scan.has_warnings || scan.has_blocks ? this.buildConsentMessage(scan) : null,
      recommendation: recommendation
    };
  }

  async createIncident(incidentType, severity, agentId, requestHash, description, evidence) {
    try {
      var evtHash = hashText(JSON.stringify({ description: description }));
      var r = await pool.query(
        'INSERT INTO incident_reports (incident_type,severity,agent_id,request_hash,description,evidence,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW()) RETURNING id',
        [incidentType, severity, agentId, requestHash || evtHash, description, evidence]
      );
      return r.rows[0].id;
    } catch(e) { return null; }
  }

  // Main scan with consent flow
  async scanAndDecide(inputText, agentId, checkTypes) {
    if (!checkTypes) checkTypes = ['privacy', 'gdpr'];
    var results = {};
    var shouldBlock = false;
    var needsConsent = false;
    var maskedText = inputText;
    var consentMessage = null;

    for (var i = 0; i < checkTypes.length; i++) {
      var ct = checkTypes[i];
      try {
        if (ct === 'privacy') {
          var privacy = await this.assessPrivacy(inputText, agentId);
          results.privacy = privacy;
          if (privacy.should_block) shouldBlock = true;
          if (privacy.needs_consent) { needsConsent = true; consentMessage = privacy.consent_message; }
          maskedText = privacy.masked_text;
        } else if (ct === 'gdpr') {
          var gdpr = await this.gdprCheck(inputText, '', agentId);
          results.gdpr = gdpr;
          if (!gdpr.passed && gdpr.risk_score >= 80) shouldBlock = true;
        }
      } catch(e) { results[ct] = { error: e.message }; }
    }

    return {
      allowed: !shouldBlock && !needsConsent,
      blocked: shouldBlock,
      needs_consent: needsConsent,
      consent_message: consentMessage,
      masked_text: maskedText,
      checks: results
    };
  }

  // Called after user explicitly consents
  async consentAndProceed(inputText, agentId) {
    var scan = await this.scanText(inputText, agentId);
    // Log consent
    try {
      var evtHash = hashText('consent:' + inputText);
      await pool.query(
        'INSERT INTO event_log (event_type,agent_id,payload,payload_hash,created_at) VALUES ($1,$2,$3::jsonb,$4,NOW())',
        ['user_consent', agentId, { action: 'consent_given', pii_types: scan.pii_types, risk: scan.total_risk_score }, evtHash]
      );
    } catch(_) {}
    return { allowed: true, masked_text: scan.masked_text, risk_level: scan.risk_level };
  }

  async getStats() {
    try {
      var c1 = await pool.query('SELECT count(*) as c FROM compliance_checks');
      var c2 = await pool.query("SELECT count(*) as c FROM compliance_checks WHERE passed=false");
      var c3 = await pool.query('SELECT count(*) as c FROM privacy_scores');
      var c4 = await pool.query("SELECT count(*) as c FROM privacy_scores WHERE overall_privacy_risk='critical'");
      var c5 = await pool.query('SELECT count(*) as c FROM incident_reports');
      var c6 = await pool.query("SELECT count(*) as c FROM incident_reports WHERE resolution_status='open'");
      var c7 = await pool.query('SELECT overall_privacy_risk, count(*) as c FROM privacy_scores GROUP BY overall_privacy_risk ORDER BY c DESC');
      var c8 = await pool.query("SELECT category, count(*) as c FROM data_sensitivity_rules WHERE active=true GROUP BY category ORDER BY c DESC");
      return {
        total_checks: c1.rows[0].c, failed_checks: c2.rows[0].c,
        total_privacy: c3.rows[0].c, critical_privacy: c4.rows[0].c,
        total_incidents: c5.rows[0].c, open_incidents: c6.rows[0].c,
        risk_distribution: c7.rows, rules_by_category: c8.rows
      };
    } catch(e) { return { error: e.message }; }
  }

  async runDiagnostic() {
    var init = await this.initialize();
    var stats = await this.getStats();
    return { agent: this.name, status: init ? 'ok' : this.status, stats: stats,
      rules_cached: this.rulesCache ? this.rulesCache.length : 0, timestamp: new Date().toISOString() };
  }
}

export var safetyComplianceLayer = new SafetyComplianceLayer();
export default safetyComplianceLayer;
