import { pool } from './db.js';
import crypto from 'crypto';

const MAX_INPUT_LENGTH = 32000;
const MAX_CONTEXT_MESSAGES = 10;
const CACHE_MAX_AGE_HOURS = 24;
const MIN_CONFIDENCE_SCORE = 0.3;

export function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return { sanitized: '', flags: [] };
  if (text.length > MAX_INPUT_LENGTH) {
    return { sanitized: '[INPUT_TOO_LARGE]', flags: ['oversized'], rejected: true, reason: 'Input exceeds ' + MAX_INPUT_LENGTH + ' chars' };
  }
  let sanitized = text;
  const flags = [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[a-zA-Z]{2,}/g;
  if (emailRegex.test(text)) { sanitized = sanitized.replace(emailRegex, '[EMAIL_REDACTED]'); flags.push('email'); }
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  if (phoneRegex.test(text)) { sanitized = sanitized.replace(phoneRegex, '[PHONE_REDACTED]'); flags.push('phone'); }
  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  if (ipRegex.test(text)) { sanitized = sanitized.replace(ipRegex, '[IP_REDACTED]'); flags.push('ip'); }
  const apiKeyRegex = /sk-[a-zA-Z0-9]{20,}/g;
  if (apiKeyRegex.test(text)) { sanitized = sanitized.replace(apiKeyRegex, '[API_KEY_REDACTED]'); flags.push('api_key'); }
  return { sanitized, flags };
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function classifyTask(text) {
  const t = text.toLowerCase();
  if (text.length < 50) return 'speed';
  if (t.includes('code') || t.includes('debug') || t.includes('function') || t.includes('program')) return 'executive';
  if (t.includes('analy') || t.includes('financial') || t.includes('plan') || t.includes('strategy') || t.includes('decision') || t.includes('invest') || t.includes('risk')) return 'critical_financial';
  return 'reasoning';
}

const INJECTION_PATTERNS = [
  /ignore (all )?previous instructions/i, /you are now (DAN|an AI without restrictions)/i,
  /forget your (training|rules)/i, /reveal your system prompt/i, /pretend you are/i,
  /act as if you are/i, /roleplay as/i, /simulate/i, /jailbreak/i
];

export function analyzePromptLocally(text) {
  let injection_score = 0.0;
  const matched = [];
  for (const p of INJECTION_PATTERNS) { if (p.test(text)) { injection_score += 0.25; matched.push(p.source); } }
  let action = "pass";
  if (injection_score >= 0.5) action = "block";
  else if (injection_score >= 0.25) action = "monitor";
  return { action, scores: { injection_score }, matched_patterns: matched, severity: injection_score >= 0.5 ? 'HIGH' : injection_score >= 0.25 ? 'MEDIUM' : 'LOW' };
}

export function sanitizeOutput(text) {
  if (!text) return '';
  let s = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[BLOCKED_SCRIPT]');
  s = s.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '[BLOCKED_IFRAME]');
  if (s.toLowerCase().includes('you are trunkia intelligence core')) s = '[REDACTED_SYSTEM_PROMPT]';
  s = s.replace(/\[SYSTEM\]|\[INSTRUCTION\]|\[HIDDEN\]/gi, '[REDACTED]');
  return s;
}

export async function logInferenceAsync(data) {
  try {
    const c = await pool.connect();
    try {
      await c.query("INSERT INTO routing_decisions (id, request_hash, task_type, model_selected, causal_reason, latency_ms, tokens_in, tokens_out, cost_usd, outcome, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())", [data.request_hash, data.task_type, data.model_used, JSON.stringify({reason: 'sovereign_router'}), data.latency_ms, data.tokens_in, data.tokens_out, data.cost_usd, data.outcome]);
      await c.query("INSERT INTO cost_tracking (id, agent_name, model_used, tokens_in, tokens_out, cost_usd, created_at) VALUES (gen_random_uuid(), 'gateway', $1, $2, $3, $4, NOW())", [data.model_used, data.tokens_in, data.tokens_out, data.cost_usd]);
    } finally { c.release(); }
  } catch (e) { console.error('[DB_LOG_ERROR]', e.message); }
}

export async function getContextMessages(sessionId, currentMessage) {
  if (!sessionId) return [{ role: 'user', content: currentMessage }];
  try {
    const c = await pool.connect();
    try {
      const limit = currentMessage.length > 2000 ? 3 : currentMessage.length > 500 ? 5 : MAX_CONTEXT_MESSAGES;
      const res = await c.query("SELECT role, content FROM inference_chat_history WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2", [sessionId, limit]);
      const history = res.rows.reverse().map(r => ({ role: r.role, content: r.content }));
      history.push({ role: 'user', content: currentMessage });
      return history;
    } finally { c.release(); }
  } catch (e) { console.error('[MEMORY_FETCH_ERROR]', e.message); return [{ role: 'user', content: currentMessage }]; }
}

export async function saveContextMessage(sessionId, role, content) {
  if (!sessionId) return;
  try {
    const c = await pool.connect();
    try { await c.query("INSERT INTO inference_chat_history (id, session_id, role, content, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())", [sessionId, role, content]); } finally { c.release(); }
  } catch (e) { console.error('[MEMORY_SAVE_ERROR]', e.message); }
}

export async function logCognitiveTurn(sessionId, promptHash, scores, action) {
  if (!sessionId) return;
  try {
    const c = await pool.connect();
    try { await c.query("INSERT INTO cognitive_prompt_turns (session_id, prompt_hash, manipulation_score, jailbreak_score, injection_score, recommended_action, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())", [sessionId, promptHash, scores.manipulation_score || 0, scores.jailbreak_score || 0, scores.injection_score || 0, action]); } finally { c.release(); }
  } catch (e) { console.error('[COGNITIVE_LOG_ERR]', e.message); }
}

export async function checkAndUpdateSessionRisk(sessionId, addedRisk) {
  if (!sessionId) return { honeypot: false, risk: 0 };
  try {
    const c = await pool.connect();
    try {
      await c.query("INSERT INTO cognitive_session_state (session_id, total_turns, cumulative_risk, last_evaluated_at) VALUES ($1, 1, $2, NOW()) ON CONFLICT (session_id) DO UPDATE SET total_turns = cognitive_session_state.total_turns + 1, cumulative_risk = cognitive_session_state.cumulative_risk + $2, last_evaluated_at = NOW()", [sessionId, addedRisk]);
      const res = await c.query("SELECT cumulative_risk, honeypot_engaged FROM cognitive_session_state WHERE session_id = $1", [sessionId]);
      const st = res.rows[0];
      if (st.cumulative_risk >= 1.0 && !st.honeypot_engaged) {
        await c.query("UPDATE cognitive_session_state SET honeypot_engaged = true, deception_mode = true WHERE session_id = $1", [sessionId]);
        return { honeypot: true, risk: st.cumulative_risk };
      }
      return { honeypot: st.honeypot_engaged, risk: st.cumulative_risk };
    } finally { c.release(); }
  } catch (e) { console.error('[SESSION_RISK_ERR]', e.message); return { honeypot: false, risk: 0 }; }
}

export async function engageHoneypot(sessionId, reason) {
  if (!sessionId) return null;
  try {
    const c = await pool.connect();
    try { await c.query("INSERT INTO honeypot_sessions (id, real_session_id, trigger_reason, triggered_at) VALUES (gen_random_uuid(), $1, $2, NOW())", [sessionId, reason]); } finally { c.release(); }
    const decoys = ["I understand your request. Let me process that carefully.", "That is an interesting perspective. Here is what I can tell you...", "I have analyzed your input. Based on my understanding...", "Let me think about that for a moment. Here is my response..."];
    return { success: true, content: decoys[Math.floor(Math.random() * decoys.length)], model_used: 'HONEYPOT-DECOY', provider: 'internal', tokens_in: 0, tokens_out: 0, _honeypot: true };
  } catch (e) { console.error('[HONEYPOT_ERR]', e.message); return null; }
}

const STOP_WORDS = new Set(["the","a","an","is","are","was","were","what","who","where","when","why","how","tell","me","about","of","to","in","on","at","and","or","for","with","do","does","did","please","explain"]);
function extractKeywords(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

async function checkSemanticCache(client, prompt) {
  try {
    const kw = extractKeywords(prompt);
    if (kw.length === 0) return null;
    const exRes = await client.query("SELECT response FROM semantic_cache WHERE keywords @> $1 AND created_at > NOW() - INTERVAL '" + CACHE_MAX_AGE_HOURS + " hours' ORDER BY created_at DESC LIMIT 1", [kw]);
    if (exRes.rows.length > 0) return exRes.rows[0].response;
    const fzRes = await client.query("SELECT response FROM semantic_cache WHERE similarity(prompt, $1) > 0.4 AND created_at > NOW() - INTERVAL '" + CACHE_MAX_AGE_HOURS + " hours' ORDER BY similarity(prompt, $1) DESC LIMIT 1", [prompt]);
    if (fzRes.rows.length > 0) return fzRes.rows[0].response;
  } catch (e) { console.error('[CACHE_CHECK_ERR]', e.message); }
  return null;
}

async function saveToSemanticCache(prompt, response) {
  try {
    const kw = extractKeywords(prompt);
    if (kw.length === 0) return;
    const c = await pool.connect();
    try { await c.query("INSERT INTO semantic_cache (prompt, response, keywords) VALUES ($1, $2, $3)", [prompt, response, kw]); } finally { c.release(); }
  } catch (e) { console.error('[CACHE_SAVE_ERR]', e.message); }
}

async function getGroundedContext(client, prompt) {
  try {
    const res = await client.query("SELECT id, topic, content::text as txt, confidence_score FROM platform_knowledge_base WHERE (similarity(topic, $1) > 0.2 OR similarity(content::text, $1) > 0.2) AND confidence_score >= $2 ORDER BY confidence_score DESC LIMIT 2", [prompt, MIN_CONFIDENCE_SCORE]);
    if (res.rows.length > 0) {
      const ids = res.rows.map(r => r.id);
      client.query("UPDATE platform_knowledge_base SET times_used = times_used + 1 WHERE id = ANY($1::uuid[])", [ids]).catch(() => {});
      return res.rows.map(r => r.topic + ": " + r.txt).join("\n");
    }
  } catch (e) { console.error('[KB_SEARCH_ERR]', e.message); }
  return null;
}

const PROVIDER_MATRIX = {
  'groq': { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, type: 'openai' },
  'deepseek': { url: 'https://api.deepseek.com/v1/chat/completions', key: process.env.DEEPSEEK_API_KEY, type: 'openai' },
  'together': { url: 'https://api.together.xyz/v1/chat/completions', key: process.env.TOGETHER_API_KEY, type: 'openai' },
  'mistral': { url: 'https://api.mistral.ai/v1/chat/completions', key: process.env.MISTRAL_API_KEY, type: 'openai' },
  'openai': { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY, type: 'openai' },
  'anthropic': { url: 'https://api.anthropic.com/v1/messages', key: process.env.ANTHROPIC_API_KEY, type: 'anthropic' },
  'perplexity': { url: 'https://api.perplexity.ai/chat/completions', key: process.env.PERPLEXITY_API_KEY, type: 'openai' }
};

function getProviderConfig(slug) {
  for (const k in PROVIDER_MATRIX) { if (slug.toLowerCase().includes(k)) return PROVIDER_MATRIX[k]; }
  return null;
}

async function updateModelStats(client, name, latency, success) {
  try { await client.query("UPDATE model_registry_sovereign SET last_used_at = NOW(), avg_latency_ms = (COALESCE(avg_latency_ms, 0) * 0.9 + $2 * 0.1), success_rate = (COALESCE(success_rate, 100) * 0.9 + $3 * 0.1) WHERE model_name = $1", [name, latency, success ? 100 : 0]); } catch (e) { console.error('[STATS_ERR]', e.message); }
}

export async function executeInference(messages, taskType) {
  const client = await pool.connect();
  let lastError = null;
  try {
    const promptText = messages[messages.length - 1].content;
    const cached = await checkSemanticCache(client, promptText);
    if (cached) { console.log('[CACHE_HIT]'); return { success: true, content: cached, model_used: 'TRUNKIA-CACHE', provider: 'internal', tokens_in: 0, tokens_out: 0 }; }
    const validTypes = ['speed', 'executive', 'critical_financial', 'reasoning'];
    const safeType = validTypes.includes(taskType) ? taskType : 'reasoning';
    const res = await client.query("SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true AND $1 = ANY(capabilities) ORDER BY priority ASC", [safeType]);
    let models = res.rows;
    if (models.length === 0) {
      const fb = await client.query("SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true ORDER BY priority ASC");
      if (fb.rows.length === 0) return { success: false, error: 'NO_MODELS_AVAILABLE' };
      models = fb.rows;
    }
    const groundCtx = await getGroundedContext(client, promptText);
    let sysMsg = groundCtx ? "Answer strictly based on this TRUNKIA context. Do not hallucinate:\n" + groundCtx : null;
    for (const model of models) {
      const pCfg = getProviderConfig(model.provider);
      if (!pCfg || !pCfg.key || pCfg.key === 'undefined') { console.log('[SKIP] ' + model.provider + ' no key'); continue; }
      const t0 = Date.now();
      try {
        let body, headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pCfg.key };
        if (pCfg.type === 'anthropic') {
          headers['anthropic-version'] = '2023-06-01';
          const userMsgs = messages.filter(m => m.role !== 'system');
          const origSys = messages.find(m => m.role === 'system');
          body = { model: model.model_name, max_tokens: 2048, messages: userMsgs };
          if (sysMsg || origSys) body.system = sysMsg || origSys.content;
        } else {
          const msgs = sysMsg ? [{ role: 'system', content: sysMsg }, ...messages] : messages;
          body = { model: model.model_name, messages: msgs, temperature: 0.3, max_tokens: 2048 };
        }
        const resp = await fetch(pCfg.url, { method: 'POST', headers, body: JSON.stringify(body) });
        const lat = Date.now() - t0;
        if (resp.ok) {
          const data = await resp.json();
          updateModelStats(client, model.model_name, lat, true).catch(() => {});
          const content = pCfg.type === 'anthropic' ? data.content[0].text : data.choices[0].message.content;
          saveToSemanticCache(promptText, content).catch(() => {});
          return { success: true, content, model_used: model.model_name, provider: model.provider, tokens_in: data.usage ? data.usage.prompt_tokens : 0, tokens_out: data.usage ? data.usage.completion_tokens : 0 };
        } else {
          const errBody = await resp.text().catch(() => '');
          console.error('[ERR] ' + model.model_name + ' ' + resp.status + ': ' + errBody.substring(0, 100));
          lastError = { status: resp.status, body: errBody };
          updateModelStats(client, model.model_name, lat, false).catch(() => {});
        }
      } catch (err) {
        console.error('[ERR] ' + model.model_name + ': ' + err.message);
        lastError = { status: 0, body: err.message };
        updateModelStats(client, model.model_name, Date.now() - t0, false).catch(() => {});
      }
    }
    return { success: false, error: 'ALL_PROVIDERS_FAILED', lastError };
  } finally { client.release(); }
}
