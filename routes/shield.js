import dotenv from 'dotenv';
dotenv.config();
import { Router } from 'express';
import crypto from 'crypto';
import { safetyComplianceLayer } from '../agents/governance/safety-compliance-layer.js';
import { safeGroqJSON } from '../agents/utils/safe-json.js';
import { tableExists } from '../agents/utils/executor.js';
import pg from 'pg';

var router = Router();
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').substring(0, 64);
}

function extractText(messages) {
  if (!messages) return '';
  if (typeof messages === 'string') return messages;
  if (Array.isArray(messages)) {
    return messages.map(function(m) {
      if (typeof m === 'string') return m;
      return m.content || '';
    }).join(' ');
  }
  if (typeof messages === 'object' && messages.content) return messages.content;
  return JSON.stringify(messages);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function estimateCost(tokensIn, tokensOut, model) {
  if (model && model.includes('8b')) return ((tokensIn / 1000000) * 0.05) + ((tokensOut / 1000000) * 0.08);
  return ((tokensIn / 1000000) * 0.59) + ((tokensOut / 1000000) * 0.79);
}

async function writeShieldLog(eventType, data) {
  try {
    var payloadStr = JSON.stringify(data);
    var evtHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
    await pool.query(
      'INSERT INTO event_log (event_type, agent_id, payload, payload_hash, created_at) VALUES ($1,$2,$3::jsonb,$4,NOW())',
      [eventType, 'shield_api', payloadStr, evtHash]
    );
  } catch(_) {}
}

// POST /v1/shield/scan — فحص النص فقط بدون تنفيذ
router.post('/scan', async function(req, res) {
  var startTime = Date.now();
  var requestId = crypto.randomUUID();
  try {
    var messages = req.body.messages || req.body.text || req.body.input || '';
    var locale = req.body.locale || 'ar';
    var sensitivity = req.body.sensitivity || 'standard';

    var inputText = extractText(messages);
    if (!inputText || inputText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'empty_input',
        request_id: requestId
      });
    }

    var scan = await safetyComplianceLayer.scanAndDecide(inputText, 'shield_api', ['privacy', 'gdpr']);
    var latencyMs = Date.now() - startTime;

    await writeShieldLog('shield_scan', {
      request_id: requestId,
      input_length: inputText.length,
      estimated_tokens: estimateTokens(inputText),
      blocked: scan.blocked,
      needs_consent: scan.needs_consent,
      findings_count: scan.checks.privacy ? scan.checks.privacy.pii_detected : 0,
      risk_level: scan.checks.privacy ? scan.checks.privacy.risk_level : 'unknown',
      latency_ms: latencyMs,
      sensitivity: sensitivity,
      locale: locale
    });

    return res.json({
      success: true,
      request_id: requestId,
      shield: {
        allowed: scan.allowed,
        blocked: scan.blocked,
        needs_consent: scan.needs_consent,
        masked_text: scan.masked_text,
        risk_level: scan.checks.privacy ? scan.checks.privacy.risk_level : 'unknown',
        sensitivity_score: scan.checks.privacy ? scan.checks.privacy.sensitivity_score : 0,
        findings_count: scan.checks.privacy ? scan.checks.privacy.pii_detected : 0,
        consent_message: scan.consent_message,
        latency_ms: latencyMs
      }
    });

  } catch(e) {
    await writeShieldLog('shield_scan_error', { request_id: requestId, error: e.message });
    return res.status(500).json({ success: false, error: e.message, request_id: requestId });
  }
});

// POST /v1/shield/proxy — فحص + تنفيذ + فحص المخرجات
router.post('/proxy', async function(req, res) {
  var startTime = Date.now();
  var requestId = crypto.randomUUID();
  try {
    var messages = req.body.messages;
    var model = req.body.model || 'llama-3.3-70b-versatile';
    var locale = req.body.locale || 'ar';
    var optimizePrompt = req.body.optimize_prompt !== false;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages_array_required', request_id: requestId });
    }

    var inputText = extractText(messages);
    var inputTokens = estimateTokens(inputText);

    // Step 1: Scan input
    var inputScan = await safetyComplianceLayer.scanAndDecide(inputText, 'shield_proxy', ['privacy', 'gdpr']);

    if (inputScan.blocked) {
      await writeShieldLog('shield_proxy_blocked', {
        request_id: requestId,
        reason: 'input_blocked',
        model: model,
        input_tokens: inputTokens,
        latency_ms: Date.now() - startTime
      });
      return res.json({
        success: false,
        request_id: requestId,
        shield: {
          allowed: false,
          blocked: true,
          needs_consent: false,
          consent_message: inputScan.consent_message,
          risk_level: inputScan.checks.privacy ? inputScan.checks.privacy.risk_level : 'unknown',
          latency_ms: Date.now() - startTime
        }
      });
    }

    if (inputScan.needs_consent) {
      await writeShieldLog('shield_proxy_consent', {
        request_id: requestId,
        reason: 'consent_required',
        model: model,
        input_tokens: inputTokens
      });
      return res.json({
        success: false,
        request_id: requestId,
        shield: {
          allowed: false,
          blocked: false,
          needs_consent: true,
          consent_message: inputScan.consent_message,
          masked_text: inputScan.masked_text,
          risk_level: inputScan.checks.privacy ? inputScan.checks.privacy.risk_level : 'unknown',
          latency_ms: Date.now() - startTime
        }
      });
    }

    // Step 2: Use masked text for execution
    var maskedMessages = messages;
    if (inputScan.masked_text !== inputText) {
      maskedMessages = messages.map(function(m) {
        if (typeof m === 'string') return inputScan.masked_text;
        return Object.assign({}, m, { content: inputScan.masked_text });
      });
    }

    // Build prompt
    var promptText = extractText(maskedMessages);

    // Step 3: Execute
    var execStart = Date.now();
    var result = await safeGroqJSON(promptText, model, 'shield_proxy');
    var execMs = Date.now() - execStart;

    if (!result.success) {
      await writeShieldLog('shield_proxy_model_error', {
        request_id: requestId, model: model,
        error: result.error, exec_ms: execMs
      });
      return res.status(502).json({
        success: false,
        error: 'model_error: ' + result.error,
        request_id: requestId,
        shield: { input_scanned: true, output_scanned: false }
      });
    }

    var outputText = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    var outputTokens = estimateTokens(outputText);

    // Step 4: Scan output
    var outputScan = await safetyComplianceLayer.scanText(outputText, 'shield_proxy_output');
    var outputSafe = !outputScan.has_blocks;

    // Step 5: Cost calculation
    var costUsd = estimateCost(inputTokens, outputTokens, model);
    var latencyMs = Date.now() - startTime;

    // Step 6: Log
    await writeShieldLog('shield_proxy_complete', {
      request_id: requestId,
      model: model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      input_risk: inputScan.checks.privacy ? inputScan.checks.privacy.risk_level : 'low',
      output_findings: outputScan.findings.length,
      output_safe: outputSafe,
      exec_ms: execMs,
      total_ms: latencyMs,
      escalation: result.escalation ? result.escalation.tier : null
    });

    return res.json({
      success: true,
      request_id: requestId,
      data: result.data,
      shield: {
        input_scanned: true,
        input_risk: inputScan.checks.privacy ? inputScan.checks.privacy.risk_level : 'low',
        input_findings: inputScan.checks.privacy ? inputScan.checks.privacy.pii_detected : 0,
        output_scanned: true,
        output_safe: outputSafe,
        output_findings: outputScan.findings.length,
        output_masked: outputScan.masked_text !== outputText ? outputScan.masked_text : null,
        model: result.model || model,
        cached: result.cached || false,
        escalation: result.escalation || null,
        cost_usd: costUsd,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        latency_ms: latencyMs
      }
    });

  } catch(e) {
    await writeShieldLog('shield_proxy_error', { request_id: requestId, error: e.message });
    return res.status(500).json({ success: false, error: e.message, request_id: requestId });
  }
});

// GET /v1/shield/status — حالة Shield
router.get('/status', async function(req, res) {
  try {
    var init = await safetyComplianceLayer.initialize();
    var rules = await safetyComplianceLayer.getRules();
    var stats = await safetyComplianceLayer.getStats();
    return res.json({
      success: true,
      shield: {
        status: init ? 'operational' : 'degraded',
        active_rules: rules.length,
        rules_by_category: stats.rules_by_category,
        total_scans: stats.total_checks,
        total_incidents: stats.total_incidents,
        open_incidents: stats.open_incidents
      }
    });
  } catch(e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /v1/shield/consent — بعد موافقة المستخدم
router.post('/consent', async function(req, res) {
  var requestId = crypto.randomUUID();
  try {
    var messages = req.body.messages || req.body.text || '';
    var inputText = extractText(messages);
    if (!inputText) return res.status(400).json({ success: false, error: 'empty_input', request_id: requestId });

    var result = await safetyComplianceLayer.consentAndProceed(inputText, 'shield_consent');
    await writeShieldLog('shield_consent_given', { request_id: requestId, risk_level: result.risk_level });

    return res.json({
      success: true,
      request_id: requestId,
      shield: {
        allowed: true,
        masked_text: result.masked_text,
        risk_level: result.risk_level
      }
    });
  } catch(e) {
    return res.status(500).json({ success: false, error: e.message, request_id: requestId });
  }
});

export default router;
