import { pool } from './db.js';

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

// Magic: Output Guard - Sanitize AI response before reaching user
export function sanitizeOutput(text) {
  if (!text) return '';
  // Prevent XSS if AI tries to return HTML/Scripts
  let sanitized = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[BLOCKED_SCRIPT]');
  // Prevent System Prompt leakage
  if (sanitized.toLowerCase().includes('you are trunkia intelligence core')) {
    sanitized = '[REDACTED_SYSTEM_PROMPT]';
  }
  return sanitized;
}

// Magic: Async DB Logger (Fire and forget)
export async function logInferenceAsync(data) {
  const client = await pool.connect();
  try {
    // 1. Insert into routing_decisions
    await client.query(
      `INSERT INTO routing_decisions (id, request_hash, task_type, model_selected, causal_reason, latency_ms, tokens_in, tokens_out, cost_usd, outcome, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [data.request_hash, data.task_type, data.model_used, JSON.stringify({reason: 'sovereign_router'}), data.latency_ms, data.tokens_in, data.tokens_out, data.cost_usd, data.outcome]
    );

    // 2. Insert into cost_tracking
    await client.query(
      `INSERT INTO cost_tracking (id, agent_name, model_used, tokens_in, tokens_out, cost_usd, created_at)
       VALUES (gen_random_uuid(), 'gateway', $1, $2, $3, $4, NOW())`,
      [data.model_used, data.tokens_in, data.tokens_out, data.cost_usd]
    );
  } catch (err) {
    console.error('[DB_LOG_ERROR]', err.message);
  } finally {
    client.release();
  }
}


// ─────────────────────────────────────────────────────────────
// MEMORY LAYER: Short-Term Context Grounding
// ─────────────────────────────────────────────────────────────
export async function getContextMessages(sessionId, currentMessage) {
  if (!sessionId) return [{ role: 'user', content: currentMessage }];
  
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT role, content FROM brain_working_memory WHERE session_id = $1 ORDER BY created_at DESC LIMIT 3",
      [sessionId]
    );
    
    // Reverse to maintain chronological order
    const history = res.rows.reverse().map(r => ({ role: r.role, content: r.content }));
    history.push({ role: 'user', content: currentMessage });
    return history;
  } catch (err) {
    console.error('[MEMORY_FETCH_ERROR]', err.message);
    return [{ role: 'user', content: currentMessage }];
  } finally {
    client.release();
  }
}

export async function saveContextMessage(sessionId, role, content) {
  if (!sessionId) return;
  
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO brain_working_memory (id, session_id, role, content, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())",
      [sessionId, role, content]
    );
  } catch (err) {
    console.error('[MEMORY_SAVE_ERROR]', err.message);
  } finally {
    client.release();
  }
}

export async function executeInference(messages, taskType) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true AND $1 = ANY(capabilities) ORDER BY priority ASC",
      [taskType]
    );

    if (res.rows.length === 0) {
      const fallback = await client.query("SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true ORDER BY priority ASC LIMIT 1");
      if (fallback.rows.length === 0) return { success: false, error: 'NO_MODELS_AVAILABLE' };
      res.rows = fallback.rows;
    }

    for (const model of res.rows) {
      const providerSlug = model.provider.toLowerCase();
      let apiKey = '';
      let baseUrl = '';
      
      if (providerSlug.includes('groq')) {
        apiKey = process.env.GROQ_API_KEY;
        baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
      } else if (providerSlug.includes('anthropic')) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        baseUrl = 'https://api.anthropic.com/v1/chat/completions';
      } else if (providerSlug.includes('deepseek')) {
        apiKey = process.env.DEEPSEEK_API_KEY;
        baseUrl = 'https://api.deepseek.com/v1/chat/completions';
      } else {
        continue; 
      }

      if (!apiKey) continue;

      try {
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
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
        console.error('[ROUTER_ERROR] Model ' + model.model_name + ' failed:', err.message);
      }
    }

    return { success: false, error: 'ALL_MODELS_FAILED_OR_NO_KEYS' };

  } finally {
    client.release();
  }
}
