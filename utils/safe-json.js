/**
 * TRUNKIA Safe JSON Parser (Interceptor) - OMEGA PROTOCOL
 * Uses the Enterprise-grade validator from lib/services to prevent ReDoS and Context Blindness.
 */
import { validateOutput } from '../lib/services/output-validator.js';
import { multiModel } from '../agents/governance/multi-model.js';

const MAX_RAW_PAYLOAD = 5242880; // 5 MB Hard Limit (Pre-Parse Memory Guard)

export async function safeGroqJSON(prompt, systemPrompt = null, agentName = 'unknown', options = {}) {
  // 1. Dynamic Inference Routing
  const result = await multiModel.runSingle('json_generation', prompt, systemPrompt || 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation, no preamble.');

  if (!result?.approved || !result.content) {
    return { data: null, error: 'INFERENCE_FAILED: ' + (result?.error || 'Unknown'), raw: null };
  }

  const content = result.content;

  // 2. Pre-Parse Memory Guard
  if (content.length > MAX_RAW_PAYLOAD) {
    console.error('[SAFE-JSON] FATAL: Raw payload exceeded memory guard (' + content.length + ' bytes). Aborting parse.');
    return { data: null, error: 'PAYLOAD_OVERFLOW', raw: content.slice(0, 1000) + '...[TRUNCATED]' };
  }

  // 3. Safe Parsing
  let parsed;
  try {
    let cleanContent = content.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleanContent);
  } catch (parseErr) {
    // Fallback: Attempt to extract JSON object using regex (Safe bounded extraction)
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return { data: null, error: 'JSON_PARSE_ERROR', raw: content };
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      return { data: null, error: 'JSON_FALLBACK_PARSE_ERROR', raw: content };
    }
  }

  // 4. Enterprise Validation (Using lib/services)
  const validation = validateOutput(parsed, {
    agentName: agentName,
    allowSensitive: options.allowSensitive || false,
    requiredFields: options.requiredFields || [],
    schema: options.schema || null
  });

  // 5. Decision Matrix
  if (!validation.valid) {
    console.warn('[SAFE-JSON] Output REJECTED. Risk: ' + validation.risk_level + ', Issues: ' + validation.issues.length);
    if (validation.risk_level === 'critical' || validation.risk_level === 'high') {
      return { data: null, error: 'SECURITY_VIOLATION:' + validation.risk_level, raw: content, validationErrors: validation.issues };
    }
    // For medium/low, return original parsed (should not happen often as validator sanitizes)
    return { data: parsed, error: null, raw: content, sanitized: false, validationWarnings: validation.issues, risk_level: validation.risk_level };
  }

  // 6. Success - Return the Deeply Sanitized Object
  return {
    data: validation.sanitized,
    error: null,
    raw: content,
    sanitized: true,
    model: result.model,
    fingerprint: validation.fingerprint,
    risk_level: validation.risk_level
  };
}

export function safeLogString(data, maxLen = 50000) {
  try {
    let str = JSON.stringify(data);
    if (str.length > maxLen) str = str.substring(0, maxLen) + '...[TRUNCATED]';
    return str;
  } catch (e) {
    return '[UNSTRINGIFIABLE]';
  }
}
