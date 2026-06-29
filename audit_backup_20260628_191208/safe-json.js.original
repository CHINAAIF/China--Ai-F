
/**
 * TRUNKIA Safe JSON Parser
 * محدث مع Output Validation Layer
 */
import validator from './output-validator.js';

export async function safeGroqJSON(prompt, systemPrompt = null, agentName = 'unknown') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { data: null, error: 'NO_GROQ_API_KEY', raw: null };
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return { data: null, error: 'GROQ_API_ERROR: ' + response.status, raw: errText };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      return { data: null, error: 'EMPTY_RESPONSE', raw: result };
    }

    // Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      return { data: null, error: 'JSON_PARSE_ERROR', raw: content };
    }

    // ★★★ OUTPUT VALIDATION — الخطوة الأمنية الجديدة ★★★
    const validation = validator.validate(parsed, agentName);
    
    if (!validation.valid) {
      console.warn('[SECURITY] Output validation failed for ' + agentName + ':', validation.errors);
      // لا نرفض، بل نستخدم النسخة المنظفة
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
      validationWarnings: validation.sanitized ? validation.errors : undefined
    };

  } catch (err) {
    return { data: null, error: 'FETCH_ERROR: ' + err.message, raw: null };
  }
}

/**
 * Safe string for DB logging — يستخدم validator.safeStringify
 */
export function safeLogString(data, maxLen = 50000) {
  return validator.safeStringify(data, maxLen);
}
