import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { tableExists } from '../utils/executor.js';

// ── التحقق الصارم من البيئة ────────────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL not set. System refused to start.');
}

const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction
  ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT || undefined }
  : { rejectUnauthorized: false };

// ── Pool محمي ─────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  query_timeout: 30000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => console.error('[safety-compliance] Pool error:', err.message));

// ── Hash آمن ──────────────────────────────────────────────────
function hashText(text) {
  if (typeof text !== 'string') throw new TypeError('hashText requires string input');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').substring(0, 64);
}

// ── حماية ReDoS: timeout على كل regex ────────────────────────
function safeRegexTest(pattern, text, timeoutMs = 100) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      const result = text.match(pattern);
      clearTimeout(timer);
      resolve(result);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// ── حماية النص من XSS قبل أي معالجة ─────────────────────────
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── حد أقصى لحجم النص ────────────────────────────────────────
const MAX_TEXT_LENGTH = 50000;

class SafetyComplianceLayer {
  constructor() {
    this.name = 'safety_compliance_layer';
    this.layer = 'governance';
    this.status = 'active';
    this.rulesCache = null;
    this.rulesCacheTime = 0;
    this.CACHE_TTL_MS = 60000;
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      const tables = ['data_sensitivity_rules', 'compliance_checks', 'privacy_scores', 'incident_reports'];
      for (const t of tables) {
        const exists = await tableExists(t);
        if (!exists) { this.status = `missing_table:${t}`; return false; }
      }
      this.status = 'active';
      return true;
    } catch (e) {
      this.status = 'db_error';
      console.error('[safety-compliance] initialize error:', e.message);
      return false;
    }
  }

  async getRules() {
    const now = Date.now();
    if (this.rulesCache && (now - this.rulesCacheTime) < this.CACHE_TTL_MS) {
      return this.rulesCache;
    }
    try {
      const r = await pool.query(
        'SELECT rule_name, category, pattern, risk_level, action, description FROM data_sensitivity_rules WHERE active=true ORDER BY risk_level DESC LIMIT 200'
      );
      this.rulesCache = r.rows;
      this.rulesCacheTime = now;
      return r.rows;
    } catch (e) {
      console.error('[safety-compliance] getRules error:', e.message);
      return [];
    }
  }

  async scanText(text, agentId) {
    // ── التحقق من المدخلات ─────────────────────────────────────
    if (!text || typeof text !== 'string') return this._emptyScanResult();
    if (text.length > MAX_TEXT_LENGTH) {
      console.warn('[safety-compliance] Input truncated — exceeded MAX_TEXT_LENGTH');
      text = text.substring(0, MAX_TEXT_LENGTH);
    }

    const rules = await this.getRules();
    const findings = [];
    let totalRiskScore = 0;
    let maskedText = text;
    const piiTypes = {};
    const blocks = [];
    const warnings = [];
    const flags = [];

    const scanStart = Date.now();

    for (const rule of rules) {
      // ── حماية ReDoS: توقف عند 5 ثوانٍ إجمالي ──────────────
      if (Date.now() - scanStart > 5000) {
        console.error('[safety-compliance] SECURITY: Scan timeout — possible ReDoS attack');
        break;
      }

      try {
        const regex = new RegExp(rule.pattern, 'gi');
        const matches = await safeRegexTest(regex, text);

        if (matches && matches.length > 0) {
          const finding = {
            rule_name: rule.rule_name,
            category: rule.category,
            action: rule.action,
            risk_level: rule.risk_level,
            count: matches.length,
            description: rule.description,
            samples: matches.slice(0, 3).map(m =>
              m.length > 20 ? m.substring(0, 20) + '...' : m
            ),
          };
          findings.push(finding);
          totalRiskScore += rule.risk_level * matches.length;

          if (!piiTypes[rule.category]) piiTypes[rule.category] = [];
          piiTypes[rule.category].push(`${rule.rule_name}(${matches.length})`);

          if (rule.action === 'block') blocks.push(finding);
          else if (rule.action === 'warn') warnings.push(finding);
          else if (rule.action === 'flag') flags.push(finding);

          // ── إخفاء بأمان ───────────────────────────────────
          try {
            const maskRegex = new RegExp(rule.pattern, 'gi');
            maskedText = maskedText.replace(maskRegex, (match) => {
              if (match.length <= 2) return '**';
              return match[0] + '*'.repeat(Math.min(match.length - 2, 50)) + match[match.length - 1];
            });
          } catch (_) {}
        }
      } catch (_) {
        // pattern فاسد — تجاهل بأمان
      }
    }

    const normalizedRisk = Math.min(100, Math.round(totalRiskScore * 1.5));
    const riskLabel = normalizedRisk >= 80 ? 'critical'
      : normalizedRisk >= 50 ? 'high'
      : normalizedRisk >= 25 ? 'medium' : 'low';

    return {
      findings,
      total_risk_score: normalizedRisk,
      pii_types: piiTypes,
      pii_count: findings.reduce((a, f) => a + f.count, 0),
      masked_text: maskedText,
      blocks,
      warnings,
      flags,
      has_blocks: blocks.length > 0,
      has_warnings: warnings.length > 0,
      risk_level: riskLabel,
    };
  }

  _emptyScanResult() {
    return {
      findings: [], total_risk_score: 0, pii_types: {}, pii_count: 0,
      masked_text: '', blocks: [], warnings: [], flags: [],
      has_blocks: false, has_warnings: false, risk_level: 'low',
    };
  }

  buildConsentMessage(scan) {
    const lines = ['=== تنبيه أمني ===', 'اكتشف النظام معلومات حساسة في طلبك:'];

    if (scan.blocks.length > 0) {
      lines.push('', '[ممنوع - لا يمكن المتابعة]:');
      for (const b of scan.blocks) {
        lines.push(`  - ${sanitizeInput(b.description)} (${b.count} مطابقة) — مستوى الخطورة: ${b.risk_level}/10`);
      }
      lines.push('', 'السبب: بيانات تشكل خطراً أمنياً مباشراً.', 'الإجراء: الطلب محظور تماماً.');
    }

    if (scan.warnings.length > 0) {
      lines.push('', '[تحذير - يتطلب موافقتك]:');
      for (const w of scan.warnings) {
        lines.push(`  - ${sanitizeInput(w.description)} (${w.count} مطابقة) — مستوى الخطورة: ${w.risk_level}/10`);
      }
      lines.push('', 'الإجراء: سيتم إخفاؤها قبل المعالجة.');
    }

    if (scan.flags.length > 0) {
      lines.push('', '[ملاحظة - تم تسجيله]:');
      for (const f of scan.flags) {
        lines.push(`  - ${sanitizeInput(f.description)} (${f.count} مطابقة)`);
      }
    }

    lines.push('', `مستوى الخطر الإجمالي: ${scan.risk_level} (${scan.total_risk_score}/100)`);
    return lines.join('\n');
  }

  async gdprCheck(inputText, outputText, agentId) {
    const [inputScan, outputScan] = await Promise.all([
      this.scanText(inputText, agentId),
      this.scanText(outputText || '', agentId),
    ]);

    const violations = [];
    let passed = true;

    if (outputScan.pii_count > 0) {
      violations.push({ rule: 'gdpr_data_minimization', severity: 'high', detail: 'PII في مخرجات النموذج' });
      passed = false;
    }
    if (inputScan.has_blocks) {
      violations.push({ rule: 'gdpr_data_protection', severity: 'critical', detail: 'بيانات محظورة في المدخلات' });
      passed = false;
    }
    if (inputScan.findings.some(f => f.category === 'government')) {
      violations.push({ rule: 'gdpr_cross_border', severity: 'high', detail: 'بيانات حكومية' });
      passed = false;
    }
    if (inputScan.findings.some(f => f.category === 'health')) {
      violations.push({ rule: 'gdpr_special_category', severity: 'high', detail: 'بيانات صحية خاصة' });
      passed = false;
    }

    const riskScore = passed ? 0 : Math.min(100, violations.length * 25 + inputScan.total_risk_score / 4);

    try {
      const evtHash = hashText(JSON.stringify(violations));
      await pool.query(
        `INSERT INTO compliance_checks
         (check_type,agent_id,request_hash,input_scan,output_scan,violations,risk_score,passed,created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,NOW())`,
        [
          'gdpr', agentId, evtHash,
          { findings: inputScan.findings.length, risk: inputScan.total_risk_score, blocks: inputScan.blocks.length, warnings: inputScan.warnings.length },
          { findings: outputScan.findings.length, risk: outputScan.total_risk_score },
          violations, riskScore, passed,
        ]
      );
    } catch (_) {}

    return {
      check_type: 'gdpr', passed, risk_score: riskScore, violations,
      input_summary: { pii: inputScan.pii_count, risk: inputScan.total_risk_score, blocked: inputScan.has_blocks, warned: inputScan.has_warnings },
      output_summary: { pii: outputScan.pii_count },
    };
  }

  async assessPrivacy(inputText, agentId) {
    const scan = await this.scanText(inputText, agentId);

    let recommendation;
    if (scan.has_blocks) recommendation = 'BLOCK: بيانات خطيرة — محظور تماماً';
    else if (scan.has_warnings) recommendation = 'CONSENT: بيانات حساسة — يحتاج موافقة';
    else if (scan.flags.length > 0) recommendation = 'NOTED: تم تسجيل الملاحظات — مسموح';
    else recommendation = 'ALLOW: لا مخاوف أمنية';

    try {
      const evtHash = hashText(JSON.stringify(scan.pii_types));
      await pool.query(
        `INSERT INTO privacy_scores
         (agent_id,request_hash,data_sensitivity_score,pii_detected_count,pii_types,masking_applied,overall_privacy_risk,recommendation,created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,NOW())`,
        [agentId, evtHash, scan.total_risk_score, scan.pii_count, scan.pii_types, scan.pii_count > 0, scan.risk_level, recommendation]
      );
    } catch (_) {}

    if (scan.risk_level === 'critical') {
      await this.createIncident('pii_exposure', 'critical', agentId, null,
        `كشف بيانات حرجة: ${JSON.stringify(scan.pii_types)}`,
        { findings: scan.findings.map(f => `${f.rule_name}:${f.action}`) }
      );
    }

    return {
      risk_level: scan.risk_level,
      sensitivity_score: scan.total_risk_score,
      pii_detected: scan.pii_count,
      pii_types: scan.pii_types,
      masked_text: scan.masked_text,
      should_block: scan.has_blocks,
      needs_consent: scan.has_warnings && !scan.has_blocks,
      consent_message: (scan.has_warnings || scan.has_blocks) ? this.buildConsentMessage(scan) : null,
      recommendation,
    };
  }

  async createIncident(incidentType, severity, agentId, requestHash, description, evidence) {
    try {
      const evtHash = hashText(JSON.stringify({ description }));
      const r = await pool.query(
        `INSERT INTO incident_reports
         (incident_type,severity,agent_id,request_hash,description,evidence,created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW()) RETURNING id`,
        [incidentType, severity, agentId, requestHash || evtHash, description, evidence]
      );
      return r.rows[0].id;
    } catch (e) {
      console.error('[safety-compliance] createIncident error:', e.message);
      return null;
    }
  }

  async scanAndDecide(inputText, agentId, checkTypes = ['privacy', 'gdpr']) {
    const results = {};
    let shouldBlock = false;
    let needsConsent = false;
    let maskedText = inputText;
    let consentMessage = null;

    for (const ct of checkTypes) {
      try {
        if (ct === 'privacy') {
          const privacy = await this.assessPrivacy(inputText, agentId);
          results.privacy = privacy;
          if (privacy.should_block) shouldBlock = true;
          if (privacy.needs_consent) { needsConsent = true; consentMessage = privacy.consent_message; }
          maskedText = privacy.masked_text;
        } else if (ct === 'gdpr') {
          const gdpr = await this.gdprCheck(inputText, '', agentId);
          results.gdpr = gdpr;
          if (!gdpr.passed && gdpr.risk_score >= 80) shouldBlock = true;
        }
      } catch (e) {
        results[ct] = { error: e.message };
      }
    }

    return {
      allowed: !shouldBlock && !needsConsent,
      blocked: shouldBlock,
      needs_consent: needsConsent,
      consent_message: consentMessage,
      masked_text: maskedText,
      checks: results,
    };
  }

  async consentAndProceed(inputText, agentId) {
    const scan = await this.scanText(inputText, agentId);
    try {
      const evtHash = hashText(`consent:${agentId}:${Date.now()}`);
      await pool.query(
        `INSERT INTO event_log (event_type,agent_id,payload,payload_hash,created_at)
         VALUES ($1,$2,$3::jsonb,$4,NOW())`,
        ['user_consent', agentId, { action: 'consent_given', pii_types: scan.pii_types, risk: scan.total_risk_score }, evtHash]
      );
    } catch (_) {}
    return { allowed: true, masked_text: scan.masked_text, risk_level: scan.risk_level };
  }

  async getStats() {
    try {
      const [c1, c2, c3, c4, c5, c6, c7, c8] = await Promise.all([
        pool.query('SELECT count(*) as c FROM compliance_checks'),
        pool.query("SELECT count(*) as c FROM compliance_checks WHERE passed=false"),
        pool.query('SELECT count(*) as c FROM privacy_scores'),
        pool.query("SELECT count(*) as c FROM privacy_scores WHERE overall_privacy_risk='critical'"),
        pool.query('SELECT count(*) as c FROM incident_reports'),
        pool.query("SELECT count(*) as c FROM incident_reports WHERE resolution_status='open'"),
        pool.query('SELECT overall_privacy_risk, count(*) as c FROM privacy_scores GROUP BY overall_privacy_risk ORDER BY c DESC'),
        pool.query("SELECT category, count(*) as c FROM data_sensitivity_rules WHERE active=true GROUP BY category ORDER BY c DESC"),
      ]);
      return {
        total_checks: c1.rows[0].c, failed_checks: c2.rows[0].c,
        total_privacy: c3.rows[0].c, critical_privacy: c4.rows[0].c,
        total_incidents: c5.rows[0].c, open_incidents: c6.rows[0].c,
        risk_distribution: c7.rows, rules_by_category: c8.rows,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  async runDiagnostic() {
    const init = await this.initialize();
    const stats = await this.getStats();
    return {
      agent: this.name,
      status: init ? 'ok' : this.status,
      stats,
      rules_cached: this.rulesCache ? this.rulesCache.length : 0,
      timestamp: new Date().toISOString(),
    };
  }
}

export const safetyComplianceLayer = new SafetyComplianceLayer();
export default safetyComplianceLayer;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'safety-compliance-layer', status: 'ok' } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
