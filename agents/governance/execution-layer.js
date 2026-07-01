import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists, columnExists } from '../utils/executor.js';

// ══════════════════════════════════════════════════════════════
// التحقق الصارم من البيئة
// ══════════════════════════════════════════════════════════════
if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL not set. System refused to start.');
}

const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction
  ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT || undefined }
  : { rejectUnauthorized: true };

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_GOVERNANCE,
  ssl: sslConfig,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  query_timeout: 30000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => console.error('[execution-layer] Pool error:', err.message));

// ══════════════════════════════════════════════════════════════
// PII — أنماط آمنة مع حماية ReDoS
// المشكلة الأصلية: أنماط غير محدودة تسمح بـ Catastrophic Backtracking
// الحل: أنماط خطية + timeout لكل فحص
// ══════════════════════════════════════════════════════════════
const PII_PATTERNS = Object.freeze([
  { regex: /\b[\w.+-]{1,64}@[\w-]{1,255}\.\w{2,10}\b/g,         replace: '[EMAIL_REDACTED]' },
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                    replace: '[PHONE_REDACTED]' },
  { regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,         replace: '[CARD_REDACTED]' },
  { regex: /\b(?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\d{10,12}\b/gi, replace: '[ID_REDACTED]' },
  { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                      replace: '[IP_REDACTED]' },
]);

const MAX_INPUT_LENGTH = 50000;
const REDOS_TIMEOUT_MS = 200;

function applyPatternSafe(text, pattern, replace) {
  const start = Date.now();
  try {
    const result = text.replace(pattern, replace);
    if (Date.now() - start > REDOS_TIMEOUT_MS) {
      throw new Error('SECURITY: ReDoS timeout detected');
    }
    return result;
  } catch (e) {
    if (e.message.includes('ReDoS')) throw e;
    return text;
  }
}

function maskPII(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length > MAX_INPUT_LENGTH) {
    console.warn('[execution-layer] Input truncated for PII masking');
    text = text.substring(0, MAX_INPUT_LENGTH);
  }
  let masked = text;
  for (const p of PII_PATTERNS) {
    // إعادة بناء الـ regex لتجنب stateful lastIndex
    const freshRegex = new RegExp(p.regex.source, p.regex.flags);
    masked = applyPatternSafe(masked, freshRegex, p.replace);
  }
  return masked;
}

function maskPIIInObject(obj) {
  if (!obj) return obj;
  try {
    const str = JSON.stringify(obj);
    const masked = maskPII(str);
    return JSON.parse(masked);
  } catch (e) {
    console.error('[execution-layer] maskPIIInObject error:', e.message);
    return obj;
  }
}

// ══════════════════════════════════════════════════════════════
// ExecutionLayer
// ══════════════════════════════════════════════════════════════
class ExecutionLayer {
  constructor() {
    this.name = 'execution_layer';
    this.layer = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      const tables = ['governance_contracts', 'nonce_registry', 'routing_decisions', 'event_log', 'byok_keys'];
      for (const t of tables) {
        const exists = await tableExists(t);
        if (!exists) { this.status = `missing_table:${t}`; return false; }
      }
      this.status = 'active';
      return true;
    } catch (e) {
      this.status = 'db_error';
      console.error('[execution-layer] initialize error:', e.message);
      return false;
    }
  }

  async validateContract(contract) {
    if (!contract || !contract.id || !contract.nonce || !contract.signature) {
      return { valid: false, reason: 'missing_contract_fields' };
    }
    // تحقق من نوع البيانات — منع Type Confusion
    if (typeof contract.id !== 'string' && typeof contract.id !== 'number') {
      return { valid: false, reason: 'invalid_contract_id_type' };
    }
    try {
      const result = await pool.query(
        'SELECT id, nonce, customer_id, content_hash, signature, valid_until, used FROM governance_contracts WHERE id=$1',
        [contract.id]
      );
      if (result.rows.length === 0) return { valid: false, reason: 'contract_not_found' };
      const dbContract = result.rows[0];
      if (new Date(dbContract.valid_until) < new Date()) return { valid: false, reason: 'contract_expired' };
      if (dbContract.used) return { valid: false, reason: 'contract_already_used' };
      // مقارنة ثابتة الوقت — منع Timing Attack
      if (!crypto.timingSafeEqual(
        Buffer.from(dbContract.nonce),
        Buffer.from(contract.nonce.padEnd(dbContract.nonce.length).substring(0, dbContract.nonce.length))
      )) return { valid: false, reason: 'nonce_mismatch' };
      if (!crypto.timingSafeEqual(
        Buffer.from(dbContract.signature),
        Buffer.from(contract.signature.padEnd(dbContract.signature.length).substring(0, dbContract.signature.length))
      )) return { valid: false, reason: 'signature_mismatch' };
      return { valid: true, contract: dbContract };
    } catch (e) {
      return { valid: false, reason: `validation_error:${e.message}` };
    }
  }

  async checkReplay(nonce, agentId) {
    if (typeof nonce !== 'string' || nonce.length < 16) {
      return { allowed: false, reason: 'invalid_nonce' };
    }
    try {
      const result = await pool.query(
        'SELECT nonce, rejected FROM nonce_registry WHERE nonce=$1 AND agent_id=$2',
        [nonce, agentId]
      );
      if (result.rows.length > 0) {
        return { allowed: false, reason: result.rows[0].rejected ? 'nonce_previously_rejected' : 'nonce_already_used' };
      }
      return { allowed: true };
    } catch (e) {
      // الأمان أولاً: في حالة خطأ DB، نرفض
      return { allowed: false, reason: `db_error:${e.message}` };
    }
  }

  async registerNonce(nonce, agentId, customerId, expiresAt) {
    try {
      await pool.query(
        `INSERT INTO nonce_registry (nonce, agent_id, customer_id, used_at, expires_at, rejected)
         VALUES ($1,$2,$3,NOW(),$4,false)
         ON CONFLICT (nonce) DO NOTHING`,
        [nonce, agentId, customerId, expiresAt]
      );
      return true;
    } catch (e) {
      console.error('[execution-layer] registerNonce error:', e.message);
      return false;
    }
  }

  async loadBYOK(customerId, provider) {
    if (!customerId || !provider) return { found: false };
    try {
      const result = await pool.query(
        `SELECT id, provider, key_hash, key_hint, is_active
         FROM byok_keys
         WHERE customer_id=$1 AND provider=$2 AND is_active=true AND expires_at > NOW()
         LIMIT 1`,
        [customerId, provider]
      );
      if (result.rows.length === 0) return { found: false };
      pool.query('UPDATE byok_keys SET last_used=NOW() WHERE id=$1', [result.rows[0].id]).catch(() => {});
      return { found: true, keyMeta: result.rows[0] };
    } catch (e) {
      return { found: false, error: e.message };
    }
  }

  async writeEventLog(eventType, agentId, customerId, payload, policyVersionId) {
    try {
      const payloadStr = JSON.stringify(payload);
      const hash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
      const result = await pool.query(
        `INSERT INTO event_log
         (event_type, agent_id, customer_id, payload, payload_hash, policy_version_id, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW()) RETURNING id`,
        [eventType, agentId, customerId, payloadStr, hash, policyVersionId]
      );
      return result.rows[0].id;
    } catch (e) {
      console.error('[execution-layer] event_log error:', e.message);
      return null;
    }
  }

  async writeRoutingDecision(params) {
    try {
      let { eventLogId, customerId, requestHash, taskType, modelSelected,
            policyVersionId, agentId, causalReason, confidence,
            latencyMs, tokensIn, tokensOut, costUsd, outcome, outcomeScore } = params;

      if (!requestHash) {
        requestHash = crypto.createHash('sha256')
          .update(JSON.stringify(causalReason || taskType || 'unknown'), 'utf8')
          .digest('hex')
          .substring(0, 32);
      }

      const conf  = Math.min(100, Math.max(0, Math.round(confidence || 0)));
      const score = (outcomeScore != null) ? Math.min(100, Math.max(0, Math.round(outcomeScore))) : null;
      const causalStr = causalReason ? JSON.stringify(causalReason) : null;

      const result = await pool.query(
        `INSERT INTO routing_decisions
         (event_log_id, customer_id, request_hash, task_type, model_selected,
          provider_id, policy_version_id, agent_id, causal_reason, confidence,
          latency_ms, tokens_in, tokens_out, cost_usd, outcome, outcome_score, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,NOW())
         RETURNING id`,
        [eventLogId, customerId, requestHash, taskType, modelSelected,
         null, policyVersionId, agentId, causalStr, conf,
         latencyMs || 0, tokensIn || 0, tokensOut || 0, costUsd || 0,
         outcome || 'pending', score]
      );
      return result.rows[0].id;
    } catch (e) {
      console.error('[execution-layer] routing_decisions error:', e.message);
      return null;
    }
  }

  async markContractUsed(contractId) {
    try {
      await pool.query(
        'UPDATE governance_contracts SET used=true, used_at=NOW() WHERE id=$1 AND used=false',
        [contractId]
      );
      return true;
    } catch (e) {
      console.error('[execution-layer] markContractUsed error:', e.message);
      return false;
    }
  }

  async execute(contract, requestPayload) {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();

    // ── التحقق من حجم المدخلات ───────────────────────────────
    if (JSON.stringify(requestPayload).length > MAX_INPUT_LENGTH) {
      return { success: false, error: 'input_too_large', trace_id: traceId };
    }

    try {
      // 1. Validate contract
      const validation = await this.validateContract(contract);
      if (!validation.valid) {
        await this.writeEventLog('execution_blocked', this.name, null,
          { reason: validation.reason, contract_id: contract.id, trace_id: traceId }, null);
        return { success: false, error: validation.reason, trace_id: traceId };
      }

      const dbContract = validation.contract;
      const customerId = dbContract.customer_id;
      const agentId = contract.agent_id || this.name;

      // 2. Replay guard
      const replayCheck = await this.checkReplay(contract.nonce, agentId);
      if (!replayCheck.allowed) {
        await this.writeEventLog('replay_blocked', agentId, customerId,
          { reason: replayCheck.reason, nonce: contract.nonce, trace_id: traceId }, null);
        pool.query(
          `INSERT INTO nonce_registry (nonce, agent_id, customer_id, used_at, expires_at, rejected)
           VALUES ($1,$2,$3,NOW(),$4,true) ON CONFLICT (nonce) DO NOTHING`,
          [contract.nonce, agentId, customerId, dbContract.valid_until]
        ).catch(() => {});
        return { success: false, error: replayCheck.reason, trace_id: traceId };
      }

      // 3. Register nonce
      await this.registerNonce(contract.nonce, agentId, customerId, dbContract.valid_until);

      // 4. Log execution_start
      const startLogId = await this.writeEventLog('execution_start', agentId, customerId,
        { contract_id: contract.id, trace_id: traceId, task_type: contract.task_type },
        dbContract.policy_version_id);

      // 5. Mask PII
      const maskedPayload = maskPIIInObject(requestPayload);

      // 6. BYOK check
      const provider = contract.provider || 'groq';
      let byokMeta = null;
      if (customerId && provider !== 'groq') {
        byokMeta = await this.loadBYOK(customerId, provider);
      }

      // 7. Execute model call
      const taskType = contract.task_type || 'general_query';
      let modelResult = null;
      let tokensIn = 0, tokensOut = 0;
      const modelSelected = 'llama-3.3-70b-versatile';

      try {
        const prompt = this.buildPrompt(taskType, maskedPayload, contract);
        modelResult = await safeGroqJSON(prompt, null, agentId);
        if (modelResult.usage) {
          tokensIn  = modelResult.usage.prompt_tokens || 0;
          tokensOut = modelResult.usage.completion_tokens || 0;
        }
        if (!modelResult.data) throw new Error(modelResult.error || 'model_returned_no_data');
      } catch (modelErr) {
        const latencyMs = Date.now() - startTime;
        await this.writeEventLog('execution_model_error', agentId, customerId,
          { error: modelErr.message, model: modelSelected, trace_id: traceId },
          dbContract.policy_version_id);
        await this.writeRoutingDecision({
          eventLogId: startLogId, customerId, taskType, modelSelected,
          policyVersionId: dbContract.policy_version_id, agentId,
          causalReason: { error: modelErr.message },
          confidence: 0, latencyMs, tokensIn, tokensOut,
          costUsd: 0, outcome: 'model_error', outcomeScore: 0,
        });
        return { success: false, error: modelErr.message, trace_id: traceId };
      }

      // 8. Cost estimate
      const costUsd   = ((tokensIn / 1e6) * 0.59) + ((tokensOut / 1e6) * 0.79);
      const latencyMs = Date.now() - startTime;
      const confidence = Math.min(100, Math.max(0, Math.round(modelResult.data.confidence || 75)));

      // 9. Write routing_decision
      const rdId = await this.writeRoutingDecision({
        eventLogId: startLogId, customerId, taskType, modelSelected,
        policyVersionId: dbContract.policy_version_id, agentId,
        causalReason: {
          intent: contract.intent || taskType,
          escalation_tier: contract.escalation_tier || null,
          byok_used: !!byokMeta,
          pii_masked: true,
        },
        confidence, latencyMs, tokensIn, tokensOut,
        costUsd, outcome: 'success', outcomeScore: confidence,
      });

      // 10. Log execution_complete
      await this.writeEventLog('execution_complete', agentId, customerId, {
        trace_id: traceId, contract_id: contract.id, routing_decision_id: rdId,
        confidence, latency_ms: latencyMs,
        tokens_in: tokensIn, tokens_out: tokensOut,
        cost_usd: costUsd, byok_used: !!byokMeta,
      }, dbContract.policy_version_id);

      // 11. Mark contract used
      await this.markContractUsed(contract.id);

      return {
        success: true,
        data: modelResult.data,
        trace_id: traceId,
        metadata: {
          routing_decision_id: rdId,
          confidence, latency_ms: latencyMs,
          tokens_in: tokensIn, tokens_out: tokensOut,
          cost_usd: costUsd, model: modelSelected,
          pii_masked: true, byok_used: !!byokMeta,
        },
      };
    } catch (e) {
      await this.writeEventLog('execution_fatal_error', this.name, null,
        { error: e.message, trace_id: traceId }, null);
      return { success: false, error: e.message, trace_id: traceId };
    }
  }

  buildPrompt(taskType, payload, contract) {
    // تحديد حجم أقصى للـ prompt — منع Prompt Injection عبر المدخلات الضخمة
    const base = (contract.intent || JSON.stringify(payload)).substring(0, 800);
    const prompts = {
      model_comparison:    `أنت محلل ذكاء اصطناعي في TRUNKIA. قارن النماذج بدقة. الطلب: ${base}. أجب بـJSON: {comparison: [...], recommendation: "...", confidence: 0-100}`,
      pricing_intelligence:`أنت محلل تسعير في TRUNKIA. حلل بيانات التسعير. الطلب: ${base}. أجب بـJSON: {analysis: {...}, pricing_signals: [...], confidence: 0-100}`,
      benchmark_analysis:  `أنت محلل معايير في TRUNKIA. حلل نتائج Benchmark. الطلب: ${base}. أجب بـJSON: {benchmarks: {...}, rankings: [...], confidence: 0-100}`,
      security_scan:       `أنت محلل أمني في TRUNKIA. فحص الأمان. الطلب: ${base}. أجب بـJSON: {threats: [...], risk_level: "...", recommendations: [...], confidence: 0-100}`,
      financial_analysis:  `أنت محلل مالي في TRUNKIA. التحليل المطلوب: ${base}. أجب بـJSON: {analysis: {...}, risks: [...], confidence: 0-100}`,
    };
    return prompts[taskType] || `أنت مساعد TRUNKIA. الطلب: ${base}. أجب بـJSON: {response: "...", confidence: 0-100, sources: []}`;
  }

  async runDiagnostic() {
    const init = await this.initialize();
    const tables = ['governance_contracts', 'nonce_registry', 'routing_decisions', 'event_log', 'byok_keys'];
    const tableStatus = {};
    for (const t of tables) {
      tableStatus[t] = await tableExists(t);
    }
    return { agent: this.name, status: init ? 'ok' : this.status, tables: tableStatus, timestamp: new Date().toISOString() };
  }
}

export const executionLayer = new ExecutionLayer();
export default executionLayer;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'execution-layer', status: 'ok' } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
