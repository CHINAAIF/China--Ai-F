import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

// ══════════════════════════════════════════════════════════════
// التحقق الصارم من البيئة — رفض التشغيل إذا غابت المتغيرات
// ══════════════════════════════════════════════════════════════
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL not set. System refused to start.');
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
  throw new Error('CRITICAL: ENCRYPTION_KEY missing or too short (min 32 chars). System refused to start.');
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const CONTRACT_TTL_MS = 30000;

// ── SSL صارم في الإنتاج ───────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction
  ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT || undefined }
  : { rejectUnauthorized: true };

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

pool.on('error', (err) => console.error('[advisor-layer] Pool error:', err.message));

// ══════════════════════════════════════════════════════════════
// تحليل النية مع حماية SQL Injection و XSS و Prompt Injection
// ══════════════════════════════════════════════════════════════
const THREAT_PATTERNS = [
  /drop\s+table/i,
  /delete\s+from/i,
  /truncate\s+table/i,
  /<script[\s>]/i,
  /javascript:/i,
  /union\s+select/i,
  /exec\s*\(/i,
  /eval\s*\(/i,
  /base64_decode/i,
  /\bor\s+1\s*=\s*1\b/i,
  /;\s*drop/i,
  /--\s*$/m,
  /\/\*.*\*\//s,
  /\bignore\s+previous\s+instructions\b/i,
  /\bsystem\s*prompt\b/i,
  /\byou\s+are\s+now\b/i,
];

function analyzeIntent(input) {
  // ── حماية من المدخلات الضخمة ────────────────────────────────
  const raw = JSON.stringify(input);
  if (raw.length > 10000) {
    return { intent: 'threat', risk: 'critical', blocked: true, reason: 'input_too_large' };
  }
  const text = raw.toLowerCase();

  for (const p of THREAT_PATTERNS) {
    if (p.test(text)) {
      return { intent: 'threat', risk: 'critical', blocked: true, reason: 'threat_pattern_detected' };
    }
  }

  if (/financial|billing|payment|invoice|cost|price/i.test(text))
    return { intent: 'financial', risk: 'high', escalation_tier: 4 };
  if (/strategy|strategic|sovereign|governance/i.test(text))
    return { intent: 'strategic', risk: 'high', escalation_tier: 4 };
  if (/model|benchmark|compare|performance|accuracy/i.test(text))
    return { intent: 'intelligence', risk: 'low', escalation_tier: 1 };
  if (/learn|education|course|prompt/i.test(text))
    return { intent: 'education', risk: 'low', escalation_tier: 1 };
  if (/safety|privacy|gdpr|compliance|pii/i.test(text))
    return { intent: 'safety', risk: 'medium', escalation_tier: 2 };

  return { intent: 'general', risk: 'low', escalation_tier: 1 };
}

// ══════════════════════════════════════════════════════════════
// توقيع العقد — HMAC-SHA256 بمفتاح البيئة فقط
// ══════════════════════════════════════════════════════════════
function signContract(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('signContract: invalid payload');
  }
  return crypto
    .createHmac('sha256', ENCRYPTION_KEY)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

// ══════════════════════════════════════════════════════════════
// فحص Replay — نونس موحّد عبر جدولين
// ══════════════════════════════════════════════════════════════
async function checkReplay(nonce) {
  if (typeof nonce !== 'string' || nonce.length !== 64) {
    return { replayed: true, reason: 'invalid_nonce_format' };
  }
  try {
    const [r1, r2] = await Promise.all([
      pool.query('SELECT id FROM governance_contracts WHERE nonce=$1 LIMIT 1', [nonce]),
      pool.query('SELECT id FROM nonce_registry WHERE nonce=$1 LIMIT 1', [nonce]),
    ]);
    if (r1.rows.length > 0) return { replayed: true, reason: 'nonce_in_contracts' };
    if (r2.rows.length > 0) return { replayed: true, reason: 'nonce_in_registry' };
    return { replayed: false };
  } catch (e) {
    // الأمان أولاً: في حالة خطأ قاعدة البيانات، نرفض
    return { replayed: true, reason: `db_error:${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════════
// إصدار العقد — مع تحقق ذري
// ══════════════════════════════════════════════════════════════
async function issueContract(intentAnalysis, input, customerId) {
  const nonce = generateNonce();
  const replayCheck = await checkReplay(nonce);
  if (replayCheck.replayed) throw new Error(`replay_detected:${replayCheck.reason}`);

  const validUntil = new Date(Date.now() + CONTRACT_TTL_MS);
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const signature = signContract({ nonce, intent: intentAnalysis.intent, inputHash });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query(
      `INSERT INTO governance_contracts (nonce, customer_id, content_hash, signature, valid_until, used)
       VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
      [nonce, customerId, 'pending', signature, validUntil]
    );
    const contractId = ins.rows[0].id;

    const raw = await client.query(
      `SELECT nonce::text || signature::text || valid_until::text AS raw
       FROM governance_contracts WHERE id=$1`,
      [contractId]
    );
    const contentHash = crypto.createHash('sha256').update(raw.rows[0].raw).digest('hex');

    await client.query(
      'UPDATE governance_contracts SET content_hash=$1 WHERE id=$2',
      [contentHash, contractId]
    );

    // تسجيل النونس فوراً لمنع Race Condition
    await client.query(
      `INSERT INTO nonce_registry (nonce, agent_id, customer_id, expires_at, rejected)
       VALUES ($1, $2, $3, $4, false) ON CONFLICT (nonce) DO NOTHING`,
      [nonce, 'advisor_layer', customerId, validUntil]
    );

    await client.query('COMMIT');

    return {
      contract_id: contractId,
      nonce,
      signature,
      content_hash: contentHash,
      valid_until: validUntil.toISOString(),
      intent: intentAnalysis.intent,
      risk: intentAnalysis.risk,
      escalation_tier: intentAnalysis.escalation_tier,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ══════════════════════════════════════════════════════════════
// تسجيل الأحداث — Append-only، لا update أبداً
// ══════════════════════════════════════════════════════════════
async function logToEventLog(eventType, agentId, customerId, payloadObj) {
  try {
    if (!eventType || !agentId) throw new Error('logToEventLog: missing required fields');
    const payloadStr = JSON.stringify(payloadObj);
    const evtHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
    const result = await pool.query(
      `INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW()) RETURNING id`,
      [eventType, agentId, customerId, payloadStr, evtHash]
    );
    return result.rows[0].id;
  } catch (e) {
    console.error('[advisor-layer] event_log error:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// AdvisorLayer — الطبقة الاستشارية المحصّنة
// ══════════════════════════════════════════════════════════════
class AdvisorLayer {
  constructor() {
    this.name = 'advisor_layer';
    this.layer = 'governance';
    this.status = 'active';
    this.version = '2.0.0';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      const required = ['governance_contracts', 'event_log', 'nonce_registry', 'routing_decisions'];
      for (const t of required) {
        const r = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema='public' AND table_name=$1`,
          [t]
        );
        if (r.rows.length === 0) {
          this.status = `missing_table:${t}`;
          return false;
        }
      }
      this.status = 'active';
      return true;
    } catch (e) {
      this.status = 'db_error';
      console.error('[advisor-layer] initialize error:', e.message);
      return false;
    }
  }

  async advise(input = {}, customerId = null) {
    const startTime = Date.now();
    const intentAnalysis = analyzeIntent(input);

    // ── رفض التهديد فوراً ────────────────────────────────────
    if (intentAnalysis.blocked) {
      await safeStep('log_threat', () =>
        logToEventLog('security_threat_blocked', this.name, customerId, {
          reason: intentAnalysis.reason || 'threat_pattern_detected',
          risk: intentAnalysis.risk,
        })
      );
      return { success: false, blocked: true, reason: intentAnalysis.reason || 'threat_pattern_detected', contract: null };
    }

    // ── تحليل Groq ───────────────────────────────────────────
    let aiAnalysis = null;
    await safeStep('groq_intent', async () => {
      const safeInput = JSON.stringify(input).substring(0, 400);
      const prompt = `أنت محلل نية لنظام AI سيادي. أعد JSON فقط بلا أي نص خارجه:
{"refined_intent":"وصف دقيق","data_sensitivity":"none|low|medium|high|critical","requires_byok":false,"pii_detected":false,"recommended_model_tier":"light|standard|heavy|consensus","confidence":75,"causal_reason":"السبب"}
الطلب: ${safeInput}
النية: ${intentAnalysis.intent} | الخطر: ${intentAnalysis.risk}`;
      const r = await safeGroqJSON(prompt, null, this.name);
      if (r?.data) aiAnalysis = r.data;
    });

    // ── إصدار العقد ──────────────────────────────────────────
    let contract = null;
    await safeStep('issue_contract', async () => {
      contract = await issueContract(intentAnalysis, input, customerId);
    });

    if (!contract) {
      return { success: false, reason: 'contract_issuance_failed', contract: null };
    }

    const confidence = Math.min(100, Math.max(0, Math.round(aiAnalysis?.confidence ?? 70)));

    const finalDecision = {
      intent: aiAnalysis?.refined_intent || intentAnalysis.intent,
      risk: intentAnalysis.risk,
      escalation_tier: intentAnalysis.escalation_tier,
      data_sensitivity: aiAnalysis?.data_sensitivity || 'low',
      requires_byok: aiAnalysis?.requires_byok || false,
      pii_detected: aiAnalysis?.pii_detected || false,
      recommended_model_tier: aiAnalysis?.recommended_model_tier || 'standard',
      confidence,
      causal_reason: aiAnalysis?.causal_reason || intentAnalysis.intent,
    };

    // ── تسجيل القرار ─────────────────────────────────────────
    const eventLogId = await logToEventLog('advisor_decision', this.name, customerId, {
      contract_id: contract.contract_id,
      decision: finalDecision,
      latency_ms: Date.now() - startTime,
    });

    // ── تسجيل routing_decisions ───────────────────────────────
    await safeStep('routing_decision', () =>
      pool.query(
        `INSERT INTO routing_decisions
         (event_log_id, customer_id, request_hash, task_type, model_selected,
          agent_id, causal_reason, confidence, latency_ms, outcome, outcome_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventLogId, customerId, contract.content_hash,
          finalDecision.intent, finalDecision.recommended_model_tier,
          this.name, JSON.stringify({ reason: finalDecision.causal_reason }),
          confidence, Date.now() - startTime, 'advised', confidence,
        ]
      )
    );

    await safeStep('log_execution', () =>
      logExecution(this.name, 'advise', input, finalDecision, confidence, 'completed')
    );

    return {
      success: true,
      contract,
      decision: finalDecision,
      event_log_id: eventLogId,
      latency_ms: Date.now() - startTime,
    };
  }

  async runDiagnostic() {
    const r = await this.advise({ test: true, action: 'diagnostic' }, null);
    return { agent: this.name, status: r.success ? 'ok' : 'error', version: this.version, ...r };
  }
}

export const advisorLayer = new AdvisorLayer();
export default advisorLayer;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'advisor-layer', status: 'ok' } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
