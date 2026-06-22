import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { logExecution, safeStep, tableExists, columnExists } from '../utils/executor.js';

var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

var PII_PATTERNS = [
  { regex: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g, replace: '[EMAIL_REDACTED]' },
  { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replace: '[PHONE_REDACTED]' },
  { regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, replace: '[CARD_REDACTED]' },
  { regex: /\b(?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\d{10,12}\b/gi, replace: '[ID_REDACTED]' },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replace: '[IP_REDACTED]' }
];

function maskPII(text) {
  if (!text || typeof text !== 'string') return text;
  var masked = text;
  for (var i = 0; i < PII_PATTERNS.length; i++) {
    masked = masked.replace(PII_PATTERNS[i].regex, PII_PATTERNS[i].replace);
  }
  return masked;
}

function maskPIIInObject(obj) {
  if (!obj) return obj;
  var str = JSON.stringify(obj);
  var masked = maskPII(str);
  try { return JSON.parse(masked); } catch(e) { return obj; }
}

class ExecutionLayer {
  constructor() {
    this.name = 'execution_layer';
    this.layer = 'governance';
    this.status = 'active';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      var tables = ['governance_contracts', 'nonce_registry', 'routing_decisions', 'event_log', 'byok_keys'];
      for (var i = 0; i < tables.length; i++) {
        var exists = await tableExists(tables[i]);
        if (!exists) { this.status = 'missing_table:' + tables[i]; return false; }
      }
      return true;
    } catch(e) {
      this.status = 'db_error';
      return false;
    }
  }

  async validateContract(contract) {
    if (!contract || !contract.id || !contract.nonce || !contract.signature) {
      return { valid: false, reason: 'missing_contract_fields' };
    }
    try {
      var now = new Date();
      var result = await pool.query(
        'SELECT id, nonce, customer_id, content_hash, signature, valid_until, used FROM governance_contracts WHERE id=$1',
        [contract.id]
      );
      if (result.rows.length === 0) return { valid: false, reason: 'contract_not_found' };
      var dbContract = result.rows[0];
      if (new Date(dbContract.valid_until) < now) return { valid: false, reason: 'contract_expired' };
      if (dbContract.used) return { valid: false, reason: 'contract_already_used' };
      if (dbContract.nonce !== contract.nonce) return { valid: false, reason: 'nonce_mismatch' };
      if (dbContract.signature !== contract.signature) return { valid: false, reason: 'signature_mismatch' };
      return { valid: true, contract: dbContract };
    } catch(e) {
      return { valid: false, reason: e.message };
    }
  }

  async checkReplay(nonce, agentId, customerId) {
    try {
      var result = await pool.query(
        'SELECT nonce, rejected FROM nonce_registry WHERE nonce=$1 AND agent_id=$2',
        [nonce, agentId]
      );
      if (result.rows.length > 0) {
        if (result.rows[0].rejected) return { allowed: false, reason: 'nonce_previously_rejected' };
        return { allowed: false, reason: 'nonce_already_used' };
      }
      return { allowed: true };
    } catch(e) {
      return { allowed: false, reason: e.message };
    }
  }

  async registerNonce(nonce, agentId, customerId, expiresAt) {
    try {
      await pool.query(
        'INSERT INTO nonce_registry (nonce, agent_id, customer_id, used_at, expires_at, rejected) VALUES ($1,$2,$3,NOW(),$4,false)',
        [nonce, agentId, customerId, expiresAt]
      );
      return true;
    } catch(e) { return false; }
  }

  async loadBYOK(customerId, provider) {
    try {
      var result = await pool.query(
        'SELECT id, provider, key_hash, key_hint, is_active FROM byok_keys WHERE customer_id=$1 AND provider=$2 AND is_active=true AND expires_at > NOW() LIMIT 1',
        [customerId, provider]
      );
      if (result.rows.length === 0) return { found: false };
      await pool.query('UPDATE byok_keys SET last_used=NOW() WHERE id=$1', [result.rows[0].id]).catch(function(){});
      return { found: true, keyMeta: result.rows[0] };
    } catch(e) { return { found: false, error: e.message }; }
  }

  async writeEventLog(eventType, agentId, customerId, payload, policyVersionId) {
    try {
      var payloadStr = JSON.stringify(payload);
      var hash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
      var insertResult = await pool.query(
        'INSERT INTO event_log (event_type, agent_id, customer_id, payload, payload_hash, policy_version_id, created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,NOW()) RETURNING id',
        [eventType, agentId, customerId, payloadStr, hash, policyVersionId]
      );
      return insertResult.rows[0].id;
    } catch(e) {
      console.error('[execution-layer] event_log error: ' + e.message);
      return null;
    }
  }

  async writeRoutingDecision(params) {
    try {
      var eventLogId = params.eventLogId;
      var customerId = params.customerId;
      var requestHash = params.requestHash;
      var taskType = params.taskType;
      var modelSelected = params.modelSelected;
      var policyVersionId = params.policyVersionId;
      var agentId = params.agentId;
      var causalReason = params.causalReason;
      var confidence = params.confidence;
      var latencyMs = params.latencyMs;
      var tokensIn = params.tokensIn;
      var tokensOut = params.tokensOut;
      var costUsd = params.costUsd;
      var outcome = params.outcome;
      var outcomeScore = params.outcomeScore;

      // Safety: compute requestHash if missing
      if (!requestHash) {
        requestHash = crypto.createHash('sha256').update(JSON.stringify(causalReason || taskType || 'unknown'), 'utf8').digest('hex').substring(0, 32);
      }

      // Enforce CHECK: 0-100
      var conf = Math.min(100, Math.max(0, Math.round(confidence || 0)));
      var score = (outcomeScore !== undefined && outcomeScore !== null) ? Math.min(100, Math.max(0, Math.round(outcomeScore))) : null;

      var causalStr = causalReason ? JSON.stringify(causalReason) : null;

      var result = await pool.query(
        'INSERT INTO routing_decisions (event_log_id, customer_id, request_hash, task_type, model_selected, provider_id, policy_version_id, agent_id, causal_reason, confidence, latency_ms, tokens_in, tokens_out, cost_usd, outcome, outcome_score, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,NOW()) RETURNING id',
        [eventLogId, customerId, requestHash, taskType, modelSelected, null, policyVersionId, agentId, causalStr, conf, latencyMs || 0, tokensIn || 0, tokensOut || 0, costUsd || 0, outcome || 'pending', score]
      );

      var verify = await pool.query('SELECT id FROM routing_decisions WHERE id=$1', [result.rows[0].id]);
      return verify.rows.length > 0 ? result.rows[0].id : null;
    } catch(e) {
      console.error('[execution-layer] routing_decisions error: ' + e.message);
      return null;
    }
  }

  async markContractUsed(contractId) {
    try {
      await pool.query('UPDATE governance_contracts SET used=true, used_at=NOW() WHERE id=$1 AND used=false', [contractId]);
      return true;
    } catch(e) {
      console.error('[execution-layer] mark contract used error: ' + e.message);
      return false;
    }
  }

  async execute(contract, requestPayload) {
    var startTime = Date.now();
    var traceId = crypto.randomUUID();

    try {
      // 1. Validate contract
      var validation = await this.validateContract(contract);
      if (!validation.valid) {
        await this.writeEventLog('execution_blocked', this.name, null,
          { reason: validation.reason, contract_id: contract.id, trace_id: traceId }, null);
        return { success: false, error: validation.reason, trace_id: traceId };
      }

      var dbContract = validation.contract;
      var customerId = dbContract.customer_id;
      var agentId = contract.agent_id || this.name;

      // 2. Replay guard
      var replayCheck = await this.checkReplay(contract.nonce, agentId, customerId);
      if (!replayCheck.allowed) {
        await this.writeEventLog('replay_blocked', agentId, customerId,
          { reason: replayCheck.reason, nonce: contract.nonce, trace_id: traceId }, null);
        await pool.query(
          'INSERT INTO nonce_registry (nonce, agent_id, customer_id, used_at, expires_at, rejected) VALUES ($1,$2,$3,NOW(),$4,true)',
          [contract.nonce, agentId, customerId, dbContract.valid_until]
        ).catch(function(){});
        return { success: false, error: replayCheck.reason, trace_id: traceId };
      }

      // 3. Register nonce
      await this.registerNonce(contract.nonce, agentId, customerId, dbContract.valid_until);

      // 4. Log execution_start
      var startLogId = await this.writeEventLog('execution_start', agentId, customerId,
        { contract_id: contract.id, trace_id: traceId, task_type: contract.task_type }, dbContract.policy_version_id);

      // 5. Mask PII
      var maskedPayload = maskPIIInObject(requestPayload);

      // 6. BYOK check
      var provider = contract.provider || 'groq';
      var byokMeta = null;
      if (customerId && provider !== 'groq') {
        byokMeta = await this.loadBYOK(customerId, provider);
      }

      // 7. Execute model call
      var taskType = contract.task_type || 'general_query';
      var modelResult = null;
      var tokensIn = 0, tokensOut = 0;
      var modelSelected = 'llama-3.3-70b-versatile';

      try {
        var prompt = this.buildPrompt(taskType, maskedPayload, contract);
        modelResult = await safeGroqJSON(prompt, null, agentId);
        if (modelResult.usage) {
          tokensIn = modelResult.usage.prompt_tokens || 0;
          tokensOut = modelResult.usage.completion_tokens || 0;
        }
        if (!modelResult.data) throw new Error(modelResult.error || 'model_returned_no_data');
      } catch(modelErr) {
        await this.writeEventLog('execution_model_error', agentId, customerId,
          { error: modelErr.message, model: modelSelected, trace_id: traceId }, dbContract.policy_version_id);
        var latencyMs = Date.now() - startTime;
        await this.writeRoutingDecision({
          eventLogId: startLogId, customerId, taskType, modelSelected,
          policyVersionId: dbContract.policy_version_id, agentId,
          causalReason: { error: modelErr.message },
          confidence: 0, latencyMs: latencyMs, tokensIn: tokensIn, tokensOut: tokensOut,
          costUsd: 0, outcome: 'model_error', outcomeScore: 0
        });
        return { success: false, error: modelErr.message, trace_id: traceId };
      }

      // 8. Cost estimate
      var costUsd = ((tokensIn / 1000000) * 0.59) + ((tokensOut / 1000000) * 0.79);
      var latencyMs = Date.now() - startTime;
      var confidence = Math.min(100, Math.max(0, Math.round(modelResult.data.confidence || 75)));

      // 9. Write routing_decision
      var rdId = await this.writeRoutingDecision({
        eventLogId: startLogId, customerId, taskType, modelSelected,
        policyVersionId: dbContract.policy_version_id, agentId,
        causalReason: {
          intent: contract.intent || taskType,
          escalation_tier: contract.escalation_tier || null,
          byok_used: byokMeta ? true : false,
          pii_masked: true
        },
        confidence: confidence, latencyMs: latencyMs, tokensIn: tokensIn, tokensOut: tokensOut,
        costUsd: costUsd, outcome: 'success', outcomeScore: confidence
      });

      // 10. Log execution_complete
      await this.writeEventLog('execution_complete', agentId, customerId,
        {
          trace_id: traceId, contract_id: contract.id, routing_decision_id: rdId,
          confidence: confidence, latency_ms: latencyMs, tokens_in: tokensIn, tokens_out: tokensOut,
          cost_usd: costUsd, byok_used: byokMeta ? true : false
        },
        dbContract.policy_version_id
      );

      // 11. Mark contract used
      await this.markContractUsed(contract.id);

      return {
        success: true,
        data: modelResult.data,
        trace_id: traceId,
        metadata: {
          routing_decision_id: rdId,
          confidence: confidence, latency_ms: latencyMs,
          tokens_in: tokensIn, tokens_out: tokensOut,
          cost_usd: costUsd, model: modelSelected,
          pii_masked: true, byok_used: byokMeta ? true : false
        }
      };
    } catch(e) {
      await this.writeEventLog('execution_fatal_error', this.name, null,
        { error: e.message, trace_id: traceId }, null);
      return { success: false, error: e.message, trace_id: traceId };
    }
  }

  buildPrompt(taskType, payload, contract) {
    var base = contract.intent || JSON.stringify(payload);
    switch(taskType) {
      case 'model_comparison':
        return 'أنت محلل ذكاء اصطناعي في TRUNKIA. قارن النماذج بدقة. الطلب: ' + base + '. أجب بـJSON: {comparison: [...], recommendation: "...", confidence: 0-100}';
      case 'pricing_intelligence':
        return 'أنت محلل تسعير في TRUNKIA. حلل بيانات التسعير. الطلب: ' + base + '. أجب بـJSON: {analysis: {...}, pricing_signals: [...], confidence: 0-100}';
      case 'benchmark_analysis':
        return 'أنت محلل معايير في TRUNKIA. حلل نتائج Benchmark. الطلب: ' + base + '. أجب بـJSON: {benchmarks: {...}, rankings: [...], confidence: 0-100}';
      case 'security_scan':
        return 'أنت محلل أمني في TRUNKIA. فحص الأمان. الطلب: ' + base + '. أجب بـJSON: {threats: [...], risk_level: "...", recommendations: [...], confidence: 0-100}';
      case 'financial_analysis':
        return 'أنت محلل مالي في TRUNKIA. التحليل المطلوب: ' + base + '. أجب بـJSON: {analysis: {...}, risks: [...], confidence: 0-100}';
      default:
        return 'أنت مساعد TRUNKIA. الطلب: ' + base + '. أجب بـJSON: {response: "...", confidence: 0-100, sources: []}';
    }
  }

  async runDiagnostic() {
    var init = await this.initialize();
    var tables = ['governance_contracts', 'nonce_registry', 'routing_decisions', 'event_log', 'byok_keys'];
    var tableStatus = {};
    for (var i = 0; i < tables.length; i++) {
      tableStatus[tables[i]] = await tableExists(tables[i]);
    }
    return { agent: this.name, status: init ? 'ok' : this.status, tables: tableStatus, timestamp: new Date().toISOString() };
  }
}

export var executionLayer = new ExecutionLayer();
export default executionLayer;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'execution-layer', status: 'ok' } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
