import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-32-chars-minimum!!';
const CONTRACT_TTL_MS = 30000;

// ═══════════════════════════════════════════════════════════
// ADVISOR LAYER — البند 1
// العقليات: 4 + 9 + 12
// ═══════════════════════════════════════════════════════════

function analyzeIntent(input) {
  const text = JSON.stringify(input).toLowerCase();
  const threatPatterns = [
    /drop\s+table/i, /delete\s+from/i, /truncate/i,
    /<script/i, /javascript:/i, /union\s+select/i,
    /exec\s*\(/i, /eval\s*\(/i, /base64_decode/i
  ];
  for (const p of threatPatterns) {
    if (p.test(text)) return { intent: 'threat', risk: 'critical', blocked: true };
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

function signContract(payload) {
  return crypto.createHmac('sha256', ENCRYPTION_KEY)
    .update(JSON.stringify(payload)).digest('hex');
}

function generateNonce() {
  return crypto.randomBytes(32).toString('hex');
}

async function checkReplay(nonce) {
  try {
    const r1 = await pool.query(
      'SELECT id FROM governance_contracts WHERE nonce=$1 LIMIT 1', [nonce]
    );
    if (r1.rows.length > 0) return { replayed: true, reason: 'nonce_in_contracts' };
    const r2 = await pool.query(
      'SELECT id FROM nonce_registry WHERE nonce=$1 LIMIT 1', [nonce]
    );
    if (r2.rows.length > 0) return { replayed: true, reason: 'nonce_in_registry' };
    return { replayed: false };
  } catch (e) {
    return { replayed: false, warning: e.message };
  }
}

async function issueContract(intentAnalysis, input, customerId) {
  const nonce = generateNonce();

  // تحقق replay أولاً
  const replayCheck = await checkReplay(nonce);
  if (replayCheck.replayed) throw new Error('replay_detected');

  const validUntil = new Date(Date.now() + CONTRACT_TTL_MS);
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const signature = signContract({ nonce, intent: intentAnalysis.intent, inputHash });

  // INSERT بدون content_hash أولاً — القاعدة الحرجة
  const ins = await pool.query(
    `INSERT INTO governance_contracts (nonce, customer_id, content_hash, signature, valid_until, used)
     VALUES ($1,$2,$3,$4,$5,false) RETURNING id`,
    [nonce, customerId, 'pending', signature, validUntil]
  );
  const contractId = ins.rows[0].id;

  // SELECT النص الخام → hash صحيح
  const raw = await pool.query(
    `SELECT nonce::text || signature::text || valid_until::text AS raw
     FROM governance_contracts WHERE id=$1`,
    [contractId]
  );
  const contentHash = crypto.createHash('sha256').update(raw.rows[0].raw).digest('hex');

  await pool.query(
    'UPDATE governance_contracts SET content_hash=$1 WHERE id=$2',
    [contentHash, contractId]
  );

  // تحقق فعلي — القاعدة 5
  const verify = await pool.query(
    'SELECT id, content_hash FROM governance_contracts WHERE id=$1', [contractId]
  );
  if (verify.rows.length === 0) throw new Error('contract_verify_failed');

  // nonce_registry — عقلية 19
  await pool.query(
    `INSERT INTO nonce_registry (nonce, agent_id, customer_id, expires_at, rejected)
     VALUES ($1,$2,$3,$4,false) ON CONFLICT DO NOTHING`,
    [nonce, 'advisor_layer', customerId, validUntil]
  ).catch(() => {});

  return { contract_id: contractId, nonce, signature, content_hash: contentHash, valid_until: validUntil.toISOString(), intent: intentAnalysis.intent, risk: intentAnalysis.risk, escalation_tier: intentAnalysis.escalation_tier };
}

async function logToEventLog(eventType, agentId, customerId, payload) {
  try {
      // Rule: event_log_no_update blocks ALL updates - compute hash BEFORE insert
      var payloadStr = JSON.stringify(payloadObj);
      var evtHash = crypto.createHash("sha256").update(payloadStr, "utf8").digest("hex");
      var logResult = await pool.query(
        "INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id",
        [evtType, agentId, customerId, payloadStr, evtHash]
      );
      var logId = logResult.rows[0].id;

    return logId;
  } catch (e) {
    console.error('[advisor-layer] event_log error:', e.message);
    return null;
  }
}

class AdvisorLayer {
  constructor() {
    this.name = 'advisor_layer';
    this.layer = 'governance';
    this.status = 'active';
    this.version = '1.0.0';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      // فحص الجداول عبر information_schema مباشرة — لا نعتمد على tableExists(pool,t)
      const required = ['governance_contracts','event_log','nonce_registry','routing_decisions'];
      for (const t of required) {
        const r = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema='public' AND table_name=$1`, [t]
        );
        if (r.rows.length === 0) { this.status = `missing_table:${t}`; return false; }
      }
      this.status = 'active';
      return true;
    } catch (e) {
      this.status = 'db_error';
      return false;
    }
  }

  async advise(input = {}, customerId = null) {
    const startTime = Date.now();
    const intentAnalysis = analyzeIntent(input);

    // رفض التهديد فوراً
    if (intentAnalysis.blocked) {
      await safeStep('log_threat', () =>
        logToEventLog('security_threat_blocked', this.name, customerId, {
          reason: 'threat_pattern_detected', risk: intentAnalysis.risk
        })
      );
      return { success: false, blocked: true, reason: 'threat_pattern_detected', contract: null };
    }

    // Groq تحليل النية
    let aiAnalysis = null;
    await safeStep('groq_intent', async () => {
      const prompt = `أنت محلل نية لنظام AI سيادي. أعد JSON فقط بلا أي نص خارجه:
{"refined_intent":"وصف دقيق","data_sensitivity":"none|low|medium|high|critical","requires_byok":false,"pii_detected":false,"recommended_model_tier":"light|standard|heavy|consensus","confidence":75,"causal_reason":"السبب"}
الطلب: ${JSON.stringify(input).substring(0,400)}
النية: ${intentAnalysis.intent} | الخطر: ${intentAnalysis.risk}`;
      const r = await safeGroqJSON(prompt, null, this.name);
      if (r?.data) aiAnalysis = r.data;
    });

    // إصدار العقد
    let contract = null;
    await safeStep('issue_contract', async () => {
      contract = await issueContract(intentAnalysis, input, customerId);
    });

    if (!contract) return { success: false, reason: 'contract_issuance_failed', contract: null };

    const confidence = Math.min(100, Math.max(0, Math.round(aiAnalysis?.confidence || 70)));

    const finalDecision = {
      intent: aiAnalysis?.refined_intent || intentAnalysis.intent,
      risk: intentAnalysis.risk,
      escalation_tier: intentAnalysis.escalation_tier,
      data_sensitivity: aiAnalysis?.data_sensitivity || 'low',
      requires_byok: aiAnalysis?.requires_byok || false,
      pii_detected: aiAnalysis?.pii_detected || false,
      recommended_model_tier: aiAnalysis?.recommended_model_tier || 'standard',
      confidence,
      causal_reason: aiAnalysis?.causal_reason || intentAnalysis.intent
    };

    // event_log
    const eventLogId = await logToEventLog('advisor_decision', this.name, customerId, {
      contract_id: contract.contract_id,
      decision: finalDecision,
      latency_ms: Date.now() - startTime
    });

    // routing_decisions
    await safeStep('routing_decision', () =>
      pool.query(
        `INSERT INTO routing_decisions
         (event_log_id, customer_id, request_hash, task_type, model_selected,
          agent_id, causal_reason, confidence, latency_ms, outcome, outcome_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [eventLogId, customerId, contract.content_hash, finalDecision.intent,
         finalDecision.recommended_model_tier, this.name,
         JSON.stringify({ reason: finalDecision.causal_reason }),
         confidence, Date.now() - startTime, 'advised', confidence]
      )
    );

    // agent_execution_logs
    await safeStep('log_execution', () =>
      logExecution(this.name, 'advise', input, finalDecision, confidence, 'completed')
    );

    return {
      success: true,
      contract,
      decision: finalDecision,
      event_log_id: eventLogId,
      latency_ms: Date.now() - startTime
    };
  }

  async runDiagnostic() {
    const r = await this.advise({ test: true, action: 'diagnostic' }, null);
    return { agent: this.name, status: r.success ? 'ok' : 'error', version: this.version, ...r };
  }
}

export const advisorLayer = new AdvisorLayer();
export default advisorLayer;
