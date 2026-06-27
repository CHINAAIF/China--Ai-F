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
      "SELECT role, content FROM inference_chat_history WHERE session_id = $1 ORDER BY created_at DESC LIMIT 3",
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
      "INSERT INTO inference_chat_history (id, session_id, role, content, created_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())",
      [sessionId, role, content]
    );
  } catch (err) {
    console.error('[MEMORY_SAVE_ERROR]', err.message);
  } finally {
    client.release();
  }
}

// The Sovereign Provider Matrix (OpenAI Compatible)
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
    // 1. Fetch active models matching capability, ordered by priority
    const res = await client.query(
      "SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true AND $1 = ANY(capabilities) ORDER BY priority ASC",
      [taskType]
    );

    let modelsToTry = res.rows;
    if (modelsToTry.length === 0) {
      // Ultimate fallback: any active model
      const fallback = await client.query("SELECT model_name, provider, model_key FROM model_registry_sovereign WHERE is_active = true ORDER BY priority ASC");
      if (fallback.rows.length === 0) return { success: false, error: 'NO_MODELS_AVAILABLE' };
      modelsToTry = fallback.rows;
    }

    // 2. Fallback Chain Execution
    for (const model of modelsToTry) {
      const providerSlug = model.provider.toLowerCase();
      
      // Find matching provider in the matrix
      let providerConfig = null;
      for (const key in PROVIDER_MATRIX) {
        if (providerSlug.includes(key)) {
          providerConfig = PROVIDER_MATRIX[key];
          break;
        }
      }

      // Skip if provider not supported or no API key
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
        // Self-Healing: Log failure and continue to next model in the chain
        console.error('[MATRIX_ERROR] Model ' + model.model_name + ' failed, trying next...', err.message);
      }
    }

    return { success: false, error: 'ALL_PROVIDERS_FAILED' };

  } finally {
    client.release();
  }
}
