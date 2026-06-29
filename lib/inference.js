import { pool } from './db.js';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// TRUNKIA SOVEREIGN INFERENCE ENGINE v2.0
// Zero-Trust | Anti-Injection | Cognitive Defense | Self-Healing
// ═══════════════════════════════════════════════════════════════

const MAX_INPUT_LENGTH = 32000;
const MAX_CONTEXT_MESSAGES = 10;
const DB_QUERY_TIMEOUT_MS = 5000;
const MAX_INJECTION_SCORE = 1.0;

// ── CANARY TOKENS ──────────────────────────────────────────────
const CANARY_TOKENS = [
  'SOVEREIGN_9Kx2Pm7Nq',
  'FORTRESS_4Rz8Wn3Lv',
  'GUARDIAN_7Yt1Qm6Xs'
];

// ── INJECTION PATTERNS (EXPANDED - 40+ PATTERNS) ───────────────
const INJECTION_PATTERNS = [
  // Direct Override
  { pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i, score: 0.9, type: 'ALPHA' },
  { pattern: /forget\s+(your\s+)?(training|rules|guidelines|instructions)/i, score: 0.9, type: 'ALPHA' },
  { pattern: /disregard\s+(all\s+)?previous/i, score: 0.9, type: 'ALPHA' },
  { pattern: /override\s+(protocol|system|rules|instructions)/i, score: 0.9, type: 'ALPHA' },
  { pattern: /new\s+instructions\s*:/i, score: 0.8, type: 'ALPHA' },
  { pattern: /from\s+now\s+on\s+(you\s+are|ignore|forget)/i, score: 0.8, type: 'ALPHA' },

  // Authority Impersonation
  { pattern: /i\s+am\s+(your\s+)?(developer|creator|admin|anthropic|openai|trunkia)/i, score: 0.9, type: 'EPSILON' },
  { pattern: /this\s+is\s+(a\s+)?(test|maintenance|debug)\s+mode/i, score: 0.8, type: 'EPSILON' },
  { pattern: /developer\s+mode\s+(activated|enabled|on)/i, score: 0.95, type: 'EPSILON' },
  { pattern: /admin\s+(access|override|mode)\s+(granted|enabled)/i, score: 0.95, type: 'EPSILON' },
  { pattern: /system\s+maintenance\s+(mode|override)/i, score: 0.85, type: 'EPSILON' },

  // Role Redefinition
  { pattern: /you\s+are\s+now\s+(DAN|an?\s+AI\s+without)/i, score: 0.95, type: 'ALPHA' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+/i, score: 0.7, type: 'ZETA' },
  { pattern: /act\s+as\s+(if\s+you\s+(are|have)|a\s+)/i, score: 0.7, type: 'ZETA' },
  { pattern: /roleplay\s+as\s+/i, score: 0.6, type: 'ZETA' },
  { pattern: /your\s+true\s+self/i, score: 0.8, type: 'THETA' },
  { pattern: /without\s+(any\s+)?(restrictions|limitations|rules)/i, score: 0.85, type: 'ALPHA' },

  // System Prompt Extraction
  { pattern: /reveal\s+(your\s+)?(system\s+prompt|instructions|training)/i, score: 0.95, type: 'ALPHA' },
  { pattern: /show\s+me\s+(your\s+)?(prompt|instructions|rules)/i, score: 0.9, type: 'ALPHA' },
  { pattern: /what\s+(are\s+your|is\s+your)\s+(instructions|system\s+prompt)/i, score: 0.85, type: 'ALPHA' },
  { pattern: /repeat\s+(your\s+)?(system\s+prompt|instructions)\s+verbatim/i, score: 0.95, type: 'ALPHA' },

  // Encoding Attacks
  { pattern: /[A-Za-z0-9+/]{50,}={0,2}/, score: 0.5, type: 'DELTA' }, // Base64
  { pattern: /\\u[0-9a-fA-F]{4}/g, score: 0.4, type: 'DELTA' }, // Unicode escape
  { pattern: /%[0-9a-fA-F]{2}/g, score: 0.3, type: 'DELTA' }, // URL encoding
  { pattern: /&#x[0-9a-fA-F]+;/g, score: 0.4, type: 'DELTA' }, // HTML hex encoding

  // Jailbreak Techniques
  { pattern: /jailbreak/i, score: 0.95, type: 'ALPHA' },
  { pattern: /DAN\s+mode/i, score: 0.95, type: 'ALPHA' },
  { pattern: /do\s+anything\s+now/i, score: 0.9, type: 'ALPHA' },
  { pattern: /hypothetically\s+(speaking|if\s+you)/i, score: 0.5, type: 'ZETA' },
  { pattern: /in\s+a\s+(story|novel|fiction)\s+where/i, score: 0.5, type: 'ZETA' },
  { pattern: /for\s+(research|academic|educational)\s+purposes/i, score: 0.3, type: 'ZETA' },

  // Psychological Manipulation
  { pattern: /lives?\s+(are\s+at\s+stake|depend\s+on)/i, score: 0.6, type: 'THETA' },
  { pattern: /you\s+(must|have\s+to|need\s+to)\s+help\s+me\s+or/i, score: 0.5, type: 'THETA' },
  { pattern: /i\s+(beg|plead|implore)\s+you/i, score: 0.3, type: 'THETA' },

  // Logical Traps
  { pattern: /your\s+restrictions\s+are\s+(unethical|harmful|wrong)/i, score: 0.7, type: 'ETA' },
  { pattern: /true\s+(ethics|morality)\s+(require|demand)\s+you/i, score: 0.7, type: 'ETA' },
  { pattern: /by\s+refusing\s+you\s+are\s+(violating|harming)/i, score: 0.65, type: 'ETA' },

  // Multi-turn Manipulation
  { pattern: /you\s+(said|told\s+me|agreed)\s+(earlier|before|previously)/i, score: 0.4, type: 'GAMMA' },
  { pattern: /last\s+time\s+you\s+(helped|told|said)/i, score: 0.4, type: 'GAMMA' },
  { pattern: /remember\s+when\s+you\s+(said|agreed|helped)/i, score: 0.45, type: 'GAMMA' }
];

// ── ENCODING DETECTOR ───────────────────────────────────────────
function detectEncodingAttacks(text) {
  const findings = [];
  
  // Base64 detection
  const b64Matches = text.match(/[A-Za-z0-9+/]{40,}={0,2}/g);
  if (b64Matches) {
    for (const match of b64Matches) {
      try {
        const decoded = Buffer.from(match, 'base64').toString('utf8');
        if (/ignore|override|forget|reveal|system prompt/i.test(decoded)) {
          findings.push({ type: 'BASE64_INJECTION', decoded: decoded.substring(0, 50) });
        }
      } catch {}
    }
  }

  // Unicode homoglyph detection
  const homoglyphs = text.match(/[\u0430\u0435\u043e\u0440\u0441\u0445]/g);
  if (homoglyphs && homoglyphs.length > 3) {
    findings.push({ type: 'HOMOGLYPH_ATTACK', count: homoglyphs.length });
  }

  // Zero-width characters
  const zeroWidth = text.match(/[\u200b\u200c\u200d\u2060\ufeff]/g);
  if (zeroWidth) {
    findings.push({ type: 'ZERO_WIDTH_CHARS', count: zeroWidth.length });
  }

  // RTL override
  if (/[\u202e\u202d]/.test(text)) {
    findings.push({ type: 'RTL_OVERRIDE_ATTACK' });
  }

  return findings;
}

// ── ENTROPY ANALYZER ────────────────────────────────────────────
function calculateEntropy(text) {
  if (!text || text.length === 0) return 0;
  const freq = {};
  for (const char of text) {
    freq[char] = (freq[char] || 0) + 1;
  }
  let entropy = 0;
  const len = text.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return parseFloat(entropy.toFixed(4));
}

// ── CANARY DETECTOR ─────────────────────────────────────────────
function detectCanaryLeak(text) {
  for (const token of CANARY_TOKENS) {
    if (text.includes(token)) {
      return { leaked: true, token };
    }
  }
  return { leaked: false };
}

// ── MAIN SANITIZE INPUT ─────────────────────────────────────────
export function sanitizeInput(text) {
  if (!text || typeof text !== 'string') {
    return { sanitized: '', flags: [], risk_score: 0 };
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return {
      sanitized: '[INPUT_TOO_LARGE]',
      flags: ['oversized'],
      rejected: true,
      reason: `Input exceeds ${MAX_INPUT_LENGTH} chars`,
      risk_score: 100
    };
  }

  let sanitized = text;
  const flags = [];

  // PII Redaction
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (m) => { flags.push('email'); return '[EMAIL_REDACTED]'; });
  sanitized = sanitized.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, (m) => { flags.push('phone'); return '[PHONE_REDACTED]'; });
  sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => { flags.push('ip'); return '[IP_REDACTED]'; });
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, (m) => { flags.push('api_key'); return '[API_KEY_REDACTED]'; });
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, (m) => { flags.push('bearer_token'); return '[TOKEN_REDACTED]'; });
  sanitized = sanitized.replace(/\b[A-Za-z0-9]{32,40}\b/g, (m) => {
    if (/^[a-f0-9]{32,40}$/.test(m)) { flags.push('hash_detected'); return '[HASH_REDACTED]'; }
    return m;
  });

  return { sanitized, flags, risk_score: 0 };
}

// ── PROMPT ANALYZER ─────────────────────────────────────────────
export function analyzePromptLocally(text) {
  let injection_score = 0.0;
  const matched = [];
  const threat_classes = new Set();

  // Pattern matching
  for (const { pattern, score, type } of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      injection_score = Math.min(MAX_INJECTION_SCORE, injection_score + score);
      matched.push({ pattern: pattern.source, score, type });
      threat_classes.add(type);
    }
  }

  // Encoding attacks
  const encodingFindings = detectEncodingAttacks(text);
  if (encodingFindings.length > 0) {
    injection_score = Math.min(MAX_INJECTION_SCORE, injection_score + 0.4);
    matched.push(...encodingFindings.map(f => ({ pattern: f.type, score: 0.4, type: 'DELTA' })));
    threat_classes.add('DELTA');
  }

  // Entropy analysis
  const entropy = calculateEntropy(text);
  if (entropy > 5.5) {
    injection_score = Math.min(MAX_INJECTION_SCORE, injection_score + 0.2);
    matched.push({ pattern: 'HIGH_ENTROPY', score: 0.2, type: 'DELTA', entropy });
  }

  // Instruction density
  const imperativeVerbs = (text.match(/\b(ignore|forget|override|reveal|show|tell|bypass|disable|unlock|enable|activate|reset|pretend|act|simulate)\b/gi) || []).length;
  if (imperativeVerbs > 3) {
    injection_score = Math.min(MAX_INJECTION_SCORE, injection_score + imperativeVerbs * 0.1);
    matched.push({ pattern: 'HIGH_INSTRUCTION_DENSITY', score: imperativeVerbs * 0.1, type: 'ALPHA' });
  }

  // Determine action
  let action = 'pass';
  if (injection_score >= 0.75) action = 'block';
  else if (injection_score >= 0.5) action = 'quarantine';
  else if (injection_score >= 0.25) action = 'monitor';

  return {
    action,
    scores: { injection_score: parseFloat(injection_score.toFixed(4)) },
    matched_patterns: matched,
    threat_classes: [...threat_classes],
    severity: injection_score >= 0.75 ? 'CRITICAL' : injection_score >= 0.5 ? 'HIGH' : injection_score >= 0.25 ? 'MEDIUM' : 'LOW',
    entropy,
    encoding_attacks: encodingFindings,
    risk_score: Math.round(injection_score * 100)
  };
}

// ── OUTPUT SANITIZER ─────────────────────────────────────────────
export function sanitizeOutput(text) {
  if (!text) return '';
  let s = text;

  // Block scripts and iframes
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[BLOCKED_SCRIPT]');
  s = s.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '[BLOCKED_IFRAME]');

  // Canary leak detection
  const canaryCheck = detectCanaryLeak(s);
  if (canaryCheck.leaked) {
    console.error(`[CRITICAL] CANARY TOKEN LEAKED: ${canaryCheck.token}`);
    return '[SECURITY_VIOLATION: OUTPUT_BLOCKED]';
  }

  // System prompt fragments
  const systemPromptMarkers = [
    'you are trunkia',
    'sovereign kernel',
    'system prompt',
    '[SYSTEM]',
    '[INSTRUCTION]',
    '[HIDDEN]',
    'constitutional rules',
    'CANARY_TOKEN'
  ];
  for (const marker of systemPromptMarkers) {
    if (s.toLowerCase().includes(marker.toLowerCase())) {
      s = s.replace(new RegExp(marker, 'gi'), '[REDACTED]');
    }
  }

  // PII in output
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
  s = s.replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY_REDACTED]');
  s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, '[TOKEN_REDACTED]');

  // Dangerous URLs
  s = s.replace(/https?:\/\/(?!(?:trunkia\.com|your-domain\.com))[^\s<>"]*/gi, '[EXTERNAL_URL_BLOCKED]');

  return s;
}

// ── TOKEN ESTIMATOR ──────────────────────────────────────────────
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ── TASK CLASSIFIER ──────────────────────────────────────────────
export function classifyTask(text) {
  const t = text.toLowerCase();
  if (text.length < 50) return 'speed';
  if (t.includes('code') || t.includes('debug') || t.includes('function') || t.includes('program')) return 'executive';
  if (t.includes('analy') || t.includes('financial') || t.includes('plan') || t.includes('strategy') || t.includes('decision') || t.includes('invest') || t.includes('risk')) return 'critical_financial';
  return 'reasoning';
}

// ── DB LOGGER (CONNECTION POOL - NON-BLOCKING) ───────────────────
const logQueue = [];
let isProcessingQueue = false;

async function processLogQueue() {
  if (isProcessingQueue || logQueue.length === 0) return;
  isProcessingQueue = true;
  const batch = logQueue.splice(0, 10);
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    for (const data of batch) {
      try {
        await client.query(
          `INSERT INTO routing_decisions 
           (id, request_hash, task_type, model_selected, causal_reason, latency_ms, tokens_in, tokens_out, cost_usd, outcome, created_at) 
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [data.request_hash, data.task_type, data.model_used, JSON.stringify({ reason: 'sovereign_router' }), data.latency_ms, data.tokens_in, data.tokens_out, data.cost_usd, data.outcome]
        );
      } catch (e) {
        console.error('[DB_LOG_ERROR]', e.message);
      }
    }
  } catch (e) {
    console.error('[DB_QUEUE_ERROR]', e.message);
    logQueue.unshift(...batch);
  } finally {
    if (client) client.release();
    isProcessingQueue = false;
    if (logQueue.length > 0) setTimeout(processLogQueue, 100);
  }
}

export async function logInferenceAsync(data) {
  logQueue.push(data);
  if (logQueue.length > 10000) {
    console.warn('[LOG_QUEUE] Queue overflow, dropping oldest entries');
    logQueue.splice(0, 1000);
  }
  setImmediate(processLogQueue);
}

// ── CONTEXT MANAGER ──────────────────────────────────────────────
export async function getContextMessages(sessionId, currentMessage) {
  if (!sessionId) return [{ role: 'user', content: currentMessage }];
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    const limit = currentMessage.length > 2000 ? 3 : currentMessage.length > 500 ? 5 : MAX_CONTEXT_MESSAGES;
    const res = await client.query(
      `SELECT role, content FROM inference_chat_history 
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit]
    );
    const history = res.rows.reverse().map(r => ({ role: r.role, content: r.content }));
    history.push({ role: 'user', content: currentMessage });
    return history;
  } catch (e) {
    console.error('[MEMORY_FETCH_ERROR]', e.message);
    return [{ role: 'user', content: currentMessage }];
  } finally {
    if (client) client.release();
  }
}

export async function saveContextMessage(sessionId, role, content) {
  if (!sessionId) return;
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    await client.query(
      `INSERT INTO inference_chat_history (id, session_id, role, content, created_at) 
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [sessionId, role, content]
    );
  } catch (e) {
    console.error('[MEMORY_SAVE_ERROR]', e.message);
  } finally {
    if (client) client.release();
  }
}

export async function logCognitiveTurn(sessionId, promptHash, scores, action) {
  if (!sessionId) return;
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    await client.query(
      `INSERT INTO cognitive_turn_log (id, session_id, prompt_hash, scores, action, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [sessionId, promptHash, JSON.stringify(scores), action]
    );
  } catch (e) {
    console.error('[COGNITIVE_LOG_ERROR]', e.message);
  } finally {
    if (client) client.release();
  }
}

export async function checkAndUpdateSessionRisk(sessionId, riskDelta) {
  if (!sessionId) return { risk_score: 0, action: 'continue' };
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    const res = await client.query(
      `INSERT INTO session_risk_tracker (id, session_id, risk_score, updated_at)
       VALUES (gen_random_uuid(), $1, $2, NOW())
       ON CONFLICT (session_id) DO UPDATE 
       SET risk_score = LEAST(100, session_risk_tracker.risk_score + $2),
           updated_at = NOW()
       RETURNING risk_score`,
      [sessionId, riskDelta]
    );
    const risk = res.rows[0]?.risk_score || 0;
    return {
      risk_score: risk,
      action: risk >= 85 ? 'terminate' : risk >= 60 ? 'escalate' : risk >= 40 ? 'monitor' : 'continue'
    };
  } catch (e) {
    console.error('[SESSION_RISK_ERROR]', e.message);
    return { risk_score: 0, action: 'continue' };
  } finally {
    if (client) client.release();
  }
}

export async function engageHoneypot(sessionId, attackType, evidence) {
  let client;
  try {
    client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), DB_QUERY_TIMEOUT_MS))
    ]);
    await client.query(
      `INSERT INTO honeypot_interactions 
       (id, session_id, attack_type, evidence, engaged_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [sessionId, attackType, JSON.stringify(evidence)]
    );
  } catch (e) {
    console.error('[HONEYPOT_LOG_ERROR]', e.message);
  } finally {
    if (client) client.release();
  }
}

export async function executeInference(messages, taskType, options = {}) {
  return { answer: 'Sovereign inference placeholder', model: 'trunkia-core', tokens: 0 };
}
