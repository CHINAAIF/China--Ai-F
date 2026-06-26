import Groq from 'groq-sdk';

function getGroqClient() {
  const key = process.env.GROQ_API_KEY || '';
  if (!key) return null;
  return new Groq({ apiKey: key });
}

export function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return { sanitized: '', flags: [] };
  let sanitized = text;
  const flags = [];

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[a-zA-Z]{2,}/g;
  if (emailRegex.test(text)) {
    sanitized = sanitized.replace(emailRegex, '[EMAIL_REDACTED]');
    flags.push('email');
  }

  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  if (phoneRegex.test(text)) {
    sanitized = sanitized.replace(phoneRegex, '[PHONE_REDACTED]');
    flags.push('phone');
  }

  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  if (ipRegex.test(text)) {
    sanitized = sanitized.replace(ipRegex, '[IP_REDACTED]');
    flags.push('ip');
  }

  return { sanitized, flags };
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function classifyTask(text) {
  const lowerText = text.toLowerCase();
  if (text.length < 50) return 'simple';
  if (lowerText.includes('code') || lowerText.includes('function') || lowerText.includes('debug') || lowerText.includes('bug')) return 'code';
  if (lowerText.includes('analy') || lowerText.includes('compar') || lowerText.includes('benchmark')) return 'analysis';
  if (lowerText.includes('translat') || lowerText.includes('convert')) return 'translation';
  if (lowerText.includes('writ') || lowerText.includes('creat') || lowerText.includes('generat')) return 'creative';
  return 'general';
}

export function selectModel(taskType, userChoice) {
  if (userChoice) return userChoice;
  if (taskType === 'simple') return 'llama-3.1-8b-instant';
  return 'llama-3.3-70b-versatile';
}

export function estimateCost(tokensIn, tokensOut, modelKey) {
  const pricing = {
    'groq/llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
    'groq/llama-3.1-8b-instant': { in: 0.05, out: 0.08 }
  };
  const p = pricing['groq/' + modelKey] || pricing['groq/llama-3.3-70b-versatile'];
  const inCost = (tokensIn / 1000000) * p.in;
  const outCost = (tokensOut / 1000000) * p.out;
  return { input_cost: inCost, output_cost: outCost, total_cost: inCost + outCost, currency: 'usd', model: modelKey };
}

function buildSystemPrompt(taskType) {
  const base = 'You are TRUNKIA Intelligence Core. Be precise and factual. Never fabricate information.';
  if (taskType === 'code') return base + ' Return only pure code without explanations.';
  if (taskType === 'analysis') return base + ' Cite sources if possible. Rely strictly on logic.';
  return base;
}

export async function callGroq(prompt, systemPrompt, modelName) {
  const client = getGroqClient();
  if (!client) {
    return { success: false, error: 'GROQ_API_KEY not set' };
  }

  try {
    const response = await client.chat.completions.create({
      model: modelName || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt || buildSystemPrompt('general') },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2048,
    });

    return {
      success: true,
      content: response.choices[0].message.content,
      model: response.model,
      provider: 'groq',
      tokens_in: response.usage.prompt_tokens,
      tokens_out: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens
    };
  } catch (err) {
    console.error('[GROQ_ERROR]', err.message);
    return { success: false, error: 'INFERENCE_FAILED' };
  }
}
