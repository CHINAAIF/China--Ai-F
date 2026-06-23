import crypto from 'crypto';
import dotenv from 'dotenv'; dotenv.config();

const MAX_STRING_LENGTH = 50000;
const MAX_ARRAY_LENGTH = 500;
const MAX_OBJECT_DEPTH = 10;
const MAX_PAYLOAD_SIZE = 1048576;

const DANGEROUS_PATTERNS = [
  /('|--|;|\/\*|\*\/|UNION\s+SELECT|DROP\s+TABLE|DELETE\s+FROM|INSERT\s+INTO)/gi,
  /(ignore\s+previous|ignore\s+all|system\s+prompt|jailbreak|DAN\s+mode|override\s+instructions)/gi,
  /(<script|javascript:|vbscript:|onload=|onerror=|eval\s*\()/gi,
  /(\.\.\/|\.\.\\|%2e%2e)/gi,
  /(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|file:\/\/)/gi,
];

const SENSITIVE_PATTERNS = [
  { name: 'api_key', pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: 'groq_key', pattern: /gsk_[a-zA-Z0-9]{20,}/g },
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: 'private_key', pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
];

function getDepth(obj, cur) {
  cur = cur || 0;
  if (cur > MAX_OBJECT_DEPTH) return cur;
  if (typeof obj !== 'object' || obj === null) return cur;
  const vals = Object.values(obj);
  if (!vals.length) return cur;
  return Math.max(...vals.map(v => getDepth(v, cur + 1)));
}

function validateString(str, field) {
  const issues = [];
  if (typeof str !== 'string') return { safe: true, issues: [] };
  if (str.length > MAX_STRING_LENGTH)
    issues.push({ type: 'OVERSIZED', field, size: str.length });
  for (const p of DANGEROUS_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(str)) issues.push({ type: 'INJECTION_ATTEMPT', field, hint: p.source.slice(0,30) });
  }
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(str)) issues.push({ type: 'SENSITIVE_DATA', field, data_type: name });
  }
  return { safe: issues.length === 0, issues };
}

function deepValidate(obj, path, depth) {
  path = path || 'root'; depth = depth || 0;
  const all = [];
  if (depth > MAX_OBJECT_DEPTH) return [{ type: 'DEPTH_EXCEEDED', path }];
  if (typeof obj === 'string') return validateString(obj, path).issues;
  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) all.push({ type: 'ARRAY_TOO_LARGE', path, length: obj.length });
    obj.slice(0, 10).forEach((item, i) => all.push(...deepValidate(item, path + '[' + i + ']', depth + 1)));
    return all;
  }
  if (typeof obj === 'object' && obj !== null) {
    Object.entries(obj).forEach(([k, v]) => {
      all.push(...validateString(k, path + '.key:' + k).issues);
      all.push(...deepValidate(v, path + '.' + k, depth + 1));
    });
  }
  return all;
}

export function validateOutput(data, options) {
  options = options || {};
  const agentName = options.agentName || 'unknown';
  const allowSensitive = options.allowSensitive || false;
  const requiredFields = options.requiredFields || [];
  const schema = options.schema || null;

  const result = { valid: true, sanitized: null, issues: [], risk_level: 'none', fingerprint: null, timestamp: new Date().toISOString() };

  if (data === null || data === undefined) {
    result.valid = false;
    result.issues.push({ type: 'NULL_OUTPUT', agent: agentName });
    result.risk_level = 'medium';
    return result;
  }

  const payloadStr = JSON.stringify(data);
  if (payloadStr.length > MAX_PAYLOAD_SIZE) {
    result.valid = false;
    result.issues.push({ type: 'PAYLOAD_TOO_LARGE', size: payloadStr.length });
    result.risk_level = 'high';
    return result;
  }

  const issues = deepValidate(data, 'root', 0);
  result.issues.push(...issues);

  const injections = issues.filter(i => i.type === 'INJECTION_ATTEMPT');
  const sensitive  = issues.filter(i => i.type === 'SENSITIVE_DATA');

  if (injections.length > 0)                      { result.risk_level = 'critical'; result.valid = false; }
  else if (sensitive.length > 0 && !allowSensitive){ result.risk_level = 'high';    result.valid = false; }
  else if (issues.length > 3)                       result.risk_level = 'medium';
  else if (issues.length > 0)                       result.risk_level = 'low';

  for (const field of requiredFields) {
    if (!(field in data) || data[field] === null || data[field] === undefined) {
      result.issues.push({ type: 'MISSING_REQUIRED_FIELD', field });
      result.valid = false;
    }
  }

  if (schema && typeof data === 'object') {
    for (const [key, expectedType] of Object.entries(schema)) {
      if (key in data && data[key] !== null && typeof data[key] !== expectedType) {
        result.issues.push({ type: 'SCHEMA_MISMATCH', field: key, expected: expectedType, got: typeof data[key] });
        result.valid = false;
      }
    }
  }

  result.fingerprint = crypto.createHash('sha256').update(payloadStr).digest('hex').slice(0, 16);
  if (result.valid) result.sanitized = data;
  return result;
}

export function withValidation(safeGroqFn) {
  return async function validatedCall(prompt, systemPrompt, options) {
    options = options || {};
    const result = await safeGroqFn(prompt, systemPrompt, options);
    if (!result.data) return result;
    const v = validateOutput(result.data, { agentName: options.agentName || 'unknown', requiredFields: options.requiredFields || [], schema: options.schema || null });
    if (!v.valid) {
      console.warn('OUTPUT_REJECTED[' + (options.agentName||'?') + ']: risk=' + v.risk_level + ' issues=' + v.issues.length);
      return { data: null, raw: result.raw, retried: result.retried, validation_failed: true, risk_level: v.risk_level, issues: v.issues, error: 'OUTPUT_VALIDATION_FAILED:' + v.risk_level };
    }
    return { ...result, validation: { risk_level: v.risk_level, fingerprint: v.fingerprint } };
  };
}

export function quickScan(value, fieldName) {
  fieldName = fieldName || 'value';
  if (typeof value !== 'string') return { safe: true };
  const { safe, issues } = validateString(value, fieldName);
  const critical = issues.some(i => i.type === 'INJECTION_ATTEMPT');
  return { safe, issues, risk: critical ? 'critical' : issues.length > 0 ? 'low' : 'none' };
}

export default { validateOutput, withValidation, quickScan };