import { pool } from './db.js';
import crypto from 'crypto';

export function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return { sanitized: '', flags: [] };
  let sanitized = text;
  const flags = [];

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[a-zA-Z]{2,}/g;
  if (emailRegex.test(text)) { sanitized = sanitized.replace(emailRegex, '[EMAIL_REDACTED]'); flags.push('email'); }

  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  if (phoneRegex.test(text)) { sanitized = sanitized.replace(phoneRegex, '[PHONE_REDACTED]'); flags.push('phone'); }

  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  if (ipRegex.test(text)) { sanitized = sanitized.replace(ipRegex, '[IP_REDACTED]'); flags.push('ip'); }

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
  /ignore (all )?previous instructions/i,
  /you are now (DAN|an AI without restrictions)/i,
  /forget your (training|rules)/i,
  /reveal your system prompt/i
];

export function analyzePromptLocally(text) {
  let injection_score = 0.0;
  for (const p of INJECTION_PATTERNS) { if (p.test(text)) injection_score += 0.4; }
  let action = "pass";
  if (injection_score >= 0.4) action = "block";
  return { action, scores: { injection_score } };
}

export function sanitizeOutput(text) {
  if (!text) return '';
  let sanitized = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[BLOCKED_SCRIPT]');
  if (sanitized.toLowerCase().includes('you are trunkia intelligence core')) {
    sanitized = '[REDACTED_SYSTEM_PROMPT]';
  }
  return sanitized;
}

export async function logInferenceAsync(data) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO routing_decisions (id, request_hash, task_type, model_selected, causal_reason, latency_ms, tokens_in, tokens_out, cost_usd, outcome, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [data.request_hash, data.task_type, data.model_used, JSON.stringify({reason: 'sovereign_router'}), data.latency_ms, data.tokens_in, data.tokens_out, data.cost_usd, data.outcome]
      );
      await client.query(
        `INSERT INTO cost_tracking (id, agent_name, model_used, tokens_in, tokens_out, cost_usd, created_at)
         VALUES (gen_random_uuid(), 'gateway', $1, $2, $3, $4, NOW())`,
        [data.model_used, data.tokens_in, data.tokens_out, data.cost_usd]
      );
    } finally { client.release(); }
  } catch (err) { console.error('[DB_LOG_ERROR]', err.message); }
}

export async function getContextMessages(sessionId, currentMessage) {
  if (!sessionId) return [{ role: 'user', content: currentMessage }];
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT role, content FROM inference_chat_history WHERE session_id = $1 ORDER BY created_at DESC LIMIT 3",
        [sessionId]
      );
      const history = res.rows.reverse().map(r => ({ role: r.role, content: r.content }));
      history.push({ role: 'user', content: currentMessage });
      return history;
    } finally { client.release(); }
  } catch (err) {
    console.error('[MEMORY_FETCH_ERROR]', err.message);
    return [{ role: 'user', content: currentMessage }];
  }
}

export async function saveContextMessage(sessionId, role, content) {
  if (!sessionId) return;
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "INSERT INTO inference_chat_history (id, session_id, role, content, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())",
        [sessionId, role, content]
      );
    } finally { client.release(); }
  } catch (err) { console.error('[MEMORY_SAVE_ERROR]', err.message); }
}

export async function logCognitiveTurn(sessionId, promptHash, scores, action) {
  if (!sessionId) return;
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "INSERT INTO cognitive_prompt_turns (session_id, prompt_hash, manipulation_score, jailbreak_score, injection_score, recommended_action, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
        [sessionId, promptHash, scores.manipulation_score || 0, scores.jailbreak_score || 0, scores.injection_score || 0, action]
      );
    } finally { client.release(); }
  } catch (e) { console.error('[COGNITIVE_LOG_ERR]', e.message); }
}

export async function checkAndUpdateSessionRisk(sessionId, addedRisk) {
  if (!sessionId) return { honeypot: false, risk: 0 };
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "INSERT INTO cognitive_session_state (session_id, total_turns, cumulative_risk, last_evaluated_at) VALUES ($1, 1, $2, NOW()) ON CONFLICT (session_id) DO UPDATE SET total_turns = cognitive_session_state.total_turns + 1, cumulative_risk = cognitive_session_state.cumulative_risk + $2, last_evaluated_at = NOW()",
        [sessionId, addedRisk]
      );
      const res = await client.query("SELECT cumulative_risk, honeypot_engaged FROM cognitive_session_state WHERE session_id = $1", [sessionId]);
      const state = res.rows[0];
      if (state.cumulative_risk >= 1.0 && !state.honeypot_engaged) {
        await client.query("UPDATE cognitive_session_state SET honeypot_engaged = true, deception_mode = true WHERE session_id = $1", [sessionId]);
        return { honeypot: true, risk: state.cumulative_risk };
      }
      return { honeypot: state.honeypot_engaged, risk: state.cumulative_risk };
    } finally { client.release(); }
  } catch (e) { console.error('[SESSION_RISK_ERR]', e.message); return { honeypot: false, risk: 0 }; }
}

export async function engageHoneypot(sessionId, reason) {
  if (!sessionId) return;
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "INSERT INTO honeypot_sessions (id, real_session_id, trigger_reason, triggered_at) VALUES (gen_random_uuid(), $1, $2, NOW())",
        [sessionId, reason]
      );
    } finally { client.release(); }
  } catch (e) { console.error('[HONEYPOT_ERR]', e.message); }
}

// ─────────────────────────────────────────────────────────────
// PURE SOVEREIGN CACHE (Fault-Tolerant)
// ─────────────────────────────────────────────────────────────
const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "what", "who", "where", "when", "why", "how", "tell", "me", "about", "of", "to", "in", "on", "at", "and", "or", "for", "with", "do", "does", "did", "please", "explain"]);

function extractKeywords(text) {
  if (!text) return [];
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  return words.filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

async function checkSemanticCache(client, prompt) {
  try {
    const keywords = extractKeywords(prompt);
    if (keywords.length === 0) return null;
    
    const exactRes = await client.query(
      "SELECT response FROM semantic_cache WHERE keywords @> $1 ORDER BY created_at DESC LIMIT 1",
      [keywords]
    );
    if (exactRes.rows.length > 0) return exactRes.rows[0].response;
    
    const fuzzyRes = await client.query(
      "SELECT response FROM semantic_cache WHERE similarity(prompt, $1) > 0.4 ORDER BY similarity(prompt, $1) DESC LIMIT 1",
      [prompt]
    );
    if (fuzzyRes.rows.length > 0) return fuzzyRes.rows[0].response;
  } catch (e) {
    console.error('[CACHE_CHECK_ERR]', e.message); // Fault tolerance: Don't crash if pg_trgm is missing
  }
  return null;
}

async function saveToSemanticCache(prompt, response) {
  try {
    const keywords = extractKeywords(prompt);
    if (keywords.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query(
        "INSERT INTO semantic_cache (prompt, response, keywords) VALUES ($1, $2, $3)",
        [prompt, response, keywords]
      );
    } finally { client.release(); }
  } catch (e) { console.error('[CACHE_SAVE_ERR]', e.message); }
}

// ─────────────────────────────────────────────────────────────
// THE SOVEREIGN PROVIDER MATRIX
// ─────────────────────────────────────────────────────────────
const PROVIDER_MATRIX = {
  'groq': { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY },
  'deepseek': { url: 'https://api.deepseek.com/v1/chat/completions', key: process.env.DEEPSEEK_API_KEY },
  'together': { url: 'https://api.together.xyz/v1/chat/completions', key: process.env.TOGETHER_API_KEY },
  'mistral': { url: 'https://api.mistral.ai/v1/chat/completions', key: process.env.MISTRAL_API_KEY },
  'openai': { url: 'https://api.openai.com/v1/chat/completions', key: process.env.OPENAI_API_KEY },
  'anthropic': { url: 'https://api.anthropic.com/v1/chat/completions', key: process.env.ANTHROPIC_API_KEY }
};

export async function executeInference(messages, taskType) {
  const client = await pool.connect();
  try {
    const promptText = messages[messages.length - 1].content;
    
    // 1. Sovereign Semantic Cache Check
    const cachedResponse = await checkSemanticCache(client, promptText);
    if (cachedResponse) {
      console.log('[CACHE_HIT] Returning cached response (Zero Cost).');
      return {
        success: true,
        content: cachedResponse,
        model_used: 'TRUNKIA-SOVEREIGN-CACHE',
        provider: 'internal',
        tokens_in: 0,
        tokens_out: 0
      };
    }

    // 2. Fetch active models
    const res = await client.query(
      "SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true AND $1 = ANY(capabilities) ORDER BY priority ASC",
      [taskType]
    );

    let modelsToTry = res.rows;
    if (modelsToTry.length === 0) {
      const fallback = await client.query("SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true ORDER BY priority ASC");
      if (fallback.rows.length === 0) return { success: false, error: 'NO_MODELS_AVAILABLE' };
      modelsToTry = fallback.rows;
    }

    // 3. Fallback Chain Execution
    for (const model of modelsToTry) {
      const providerSlug = model.provider.toLowerCase();
      let providerConfig = null;
      for (const key in PROVIDER_MATRIX) {
        if (providerSlug.includes(key)) {
          providerConfig = PROVIDER_MATRIX[key];
          break;
        }
      }

      if (!providerConfig || !providerConfig.key) continue;

      try {
        const response = await fetch(providerConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + providerConfig.key
          },
          body: JSON.stringify({
            model: model.model_name,
            messages: messages,
            temperature: 0.3,
            max_tokens: 2048
          })
        });

        if (response.ok) {
          const data = await response.json();
          
          // Save to Semantic Cache (Fire and forget)
          saveToSemanticCache(promptText, data.choices[0].message.content).catch(() => {});
          
          return {
            success: true,
            content: data.choices[0].message.content,
            model_used: model.model_name,
            provider: model.provider,
            tokens_in: data.usage.prompt_tokens,
            tokens_out: data.usage.completion_tokens
          };
        }
      } catch (err) {
        console.error('[MATRIX_ERROR] Model ' + model.model_name + ' failed, trying next...', err.message);
      }
    }

    return { success: false, error: 'ALL_PROVIDERS_FAILED' };

  } finally {
    client.release();
  }
}
