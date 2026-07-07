/**
 * TRUNKIA Safe JSON Parser (Interceptor)
 * تمت ترقيتها لتعمل كموجه (Interceptor) يمرر جميع طلبات الوكلاء عبر بوابة الاستدلال الديناميكية.
 */
import validator from './output-validator.js';
import { multiModel } from '../agents/governance/multi-model.js';

export async function safeGroqJSON(prompt, systemPrompt = null, agentName = 'unknown') {
  // توجيه الطلب عبر البوابة الموحدة (تختار أفضل مزود، تتعافى من الأعطال)
  const result = await multiModel.runSingle('json_generation', prompt, systemPrompt || 'You are a JSON generator.');

  if (!result?.approved || !result.content) {
    return { data: null, error: 'INFERENCE_FAILED: ' + (result?.error || 'Unknown'), raw: null };
  }

  const content = result.content;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    return { data: null, error: 'JSON_PARSE_ERROR', raw: content };
  }

  const validation = validator.validate(parsed, agentName);

  if (!validation.valid) {
    if (validation.data !== null) {
      return { data: validation.data, error: null, raw: content, sanitized: true, validationWarnings: validation.errors };
    }
    return { data: null, error: 'VALIDATION_FAILED', raw: content, validationErrors: validation.errors };
  }

  return {
    data: validation.data,
    error: null,
    raw: content,
    sanitized: validation.sanitized,
    model: result.model,
    validationWarnings: validation.sanitized ? validation.errors : undefined
  };
}

export function safeLogString(data, maxLen = 50000) {
  return validator.safeStringify(data, maxLen);
}
