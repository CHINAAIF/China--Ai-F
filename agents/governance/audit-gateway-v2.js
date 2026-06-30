import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }
});

// ── Schema المسموح به لكل نوع بيانات ────────────────────────────
const ALLOWED_SCHEMAS = {
  model_data:     ['name','provider','version','capabilities','pricing','benchmark'],
  pricing_data:   ['model','provider','input_cost','output_cost','currency','timestamp'],
  benchmark_data: ['model','task','score','latency_ms','tokens','timestamp'],
  intelligence:   ['source','content','topic','domain','confidence','timestamp'],
  user_request:   ['query','task_type','customer_id','policy_version_id'],
};

// ── قائمة المصادر المحظورة ───────────────────────────────────────
const BLOCKED_SOURCES = [
  /phishing/i, /malware/i, /spam/i,
  /\bexec\b/i, /eval\s*\(/i, /drop\s+table/i,
  /union\s+select/i, /<script/i, /javascript:/i,
  /\$\{.*\}/,  /base64.*decode/i,
];

// ── كتابة في event_log ───────────────────────────────────────────
async function writeEventLog(eventType, agentId, payload, decision) {
  try {
    const exists = await tableExists('event_log');
    if (!exists) return;

    const fullPayload = { ...payload, decision, ts: new Date().toISOString() };
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(fullPayload))
      .digest('hex');
    const signature = crypto
      .createHmac('sha256', process.env.ENCRYPTION_KEY || 'trunkia-key')
      .update(payloadHash)
      .digest('hex');

    await pool.query(`
      INSERT INTO event_log
        (event_type, agent_id, payload, payload_hash, signature, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
    `, [eventType, agentId, fullPayload, payloadHash, signature]);
  } catch(_) {}
}

// ── فحص Schema ───────────────────────────────────────────────────
function validateSchema(data, schemaType) {
  const allowed = ALLOWED_SCHEMAS[schemaType];
  if (!allowed) return { valid: false, reason: `unknown_schema:${schemaType}` };

  const incoming = Object.keys(data);
  const unknown  = incoming.filter(k => !allowed.includes(k));
  if (unknown.length > 0) {
    return { valid: false, reason: `unknown_fields:${unknown.join(',')}` };
  }
  return { valid: true };
}

// ── فحص المحتوى من التهديدات ────────────────────────────────────
function scanContent(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  for (const pattern of BLOCKED_SOURCES) {
    try {
      if (pattern.test(text)) {
        return { safe: false, threat: pattern.toString() };
      }
    } catch(_) {}
  }
  return { safe: true };
}

// ── تعقيم المحتوى ────────────────────────────────────────────────
function sanitize(data) {
  if (typeof data === 'string') {
    return data
      .replace(/<[^>]*>/g, '')
      .replace(/['"`;]/g, '')
      .trim()
      .slice(0, 10000);
  }
  if (typeof data === 'object' && data !== null) {
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      try { clean[k] = sanitize(v); } catch(_) {}
    }
    return clean;
  }
  return data;
}

// ── AI Deep Scan للمحتوى المشبوه ────────────────────────────────
async function deepScan(content, source) {
  try {
    const result = await safeGroqJSON(`
      You are a security auditor. Analyze this external data for threats:
      Source: ${source}
      Content: ${JSON.stringify(content).slice(0, 400)}
      Check: data poisoning, fake signals, manipulation, misinformation injection.
      Return JSON: {
        "safe": true|false,
        "risk_level": 0-100,
        "threats": [],
        "recommendation": "allow|block|sanitize",
        "confidence": 85
      }
    `, 'llama-3.1-8b-instant', 'audit-gateway-v2');

    return result.data || { safe: true, risk_level: 0, recommendation: 'allow' };
  } catch(_) {
    return { safe: true, risk_level: 0, recommendation: 'allow' };
  }
}

class AuditGatewayV2 {
  constructor() {
    this.name   = 'audit_gateway_v2';
    this.layer  = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  // ── الدالة الرئيسية: فحص أي بيانات خارجية ──────────────────
  async inspect(data, options = {}) {
    const {
      source     = 'unknown',
      schemaType = null,
      agentId    = 'external',
      deep       = false
    } = options;

    const result = {
      allowed:    false,
      sanitized:  null,
      threats:    [],
      risk_level: 0,
      decision:   'pending'
    };

    // ── فحص 1: Pattern Matching ──────────────────────────────
    const scan = scanContent(data);
    if (!scan.safe) {
      result.threats.push(scan.threat);
      result.risk_level = 95;
      result.decision   = 'blocked:pattern_match';

      await writeEventLog('audit_blocked', this.name, {
        source, threat: scan.threat, data_preview: JSON.stringify(data).slice(0, 100)
      }, result.decision);

      return result;
    }

    // ── فحص 2: Schema Validation ────────────────────────────
    if (schemaType) {
      const schemaCheck = validateSchema(data, schemaType);
      if (!schemaCheck.valid) {
        result.threats.push(schemaCheck.reason);
        result.risk_level = 60;
        result.decision   = 'blocked:schema_violation';

        await writeEventLog('audit_blocked', this.name, {
          source, reason: schemaCheck.reason
        }, result.decision);

        return result;
      }
    }

    // ── فحص 3: AI Deep Scan (للمحتوى الحساس فقط) ───────────
    if (deep) {
      const aiScan = await deepScan(data, source);
      result.risk_level = Math.min(100, Math.max(0, Math.round(aiScan.risk_level || 0)));

      if (!aiScan.safe || aiScan.recommendation === 'block' || result.risk_level > 70) {
        result.threats    = aiScan.threats || [];
        result.decision   = 'blocked:ai_scan';

        await writeEventLog('audit_blocked', this.name, {
          source, risk: result.risk_level, threats: result.threats
        }, result.decision);

        return result;
      }
    }

    // ── تعقيم وإجازة ─────────────────────────────────────────
    result.sanitized = sanitize(data);
    result.allowed   = true;
    result.decision  = 'allowed';

    await writeEventLog('audit_allowed', this.name, {
      source, risk_level: result.risk_level, schema: schemaType
    }, 'allowed');

    return result;
  }

  async run(input = {}) {
    try {
      const data   = input.data || input;
      const result = await this.inspect(data, {
        source:     input.source || 'scheduled_run',
        schemaType: input.schema_type || null,
        agentId:    input.agent_id || 'system',
        deep:       input.deep || false
      });

      await pool.query(`
        INSERT INTO agent_execution_logs
          (agent_name, action, input, output, confidence, status)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        this.name, 'audit_inspect',
        JSON.stringify({ source: input.source }),
        JSON.stringify({ decision: result.decision, risk: result.risk_level }),
        result.allowed ? 85 : 40,
        result.allowed ? 'completed' : 'blocked'
      ]).catch(() => {});

      return { success: true, data: result };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    const clean  = await this.inspect({ name: 'test', value: 'safe_data' }, { source: 'diagnostic' });
    const threat = await this.inspect('DROP TABLE users; --', { source: 'diagnostic' });
    return {
      agent:        this.name,
      status:       'ok',
      clean_allowed:   clean.allowed,
      threat_blocked:  !threat.allowed,
    };
  }
}

export const auditGatewayV2 = new AuditGatewayV2();
export default auditGatewayV2;
