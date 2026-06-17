/**
 * safe-json.js — تنقية ردود Groq وparse آمن مع retry
 */
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

// lazy init — لا يُنشأ حتى أول استخدام
let _groq;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

export function cleanGroqText(text) {
  if (!text) return '';
  return text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim();
}

export function tryParseJSON(text) {
  try { return { ok: true, data: JSON.parse(cleanGroqText(text)) }; }
  catch(e) { return { ok: false, error: e.message }; }
}

export async function safeGroqJSON(prompt, systemPrompt = 'Respond ONLY with a valid JSON object. No markdown. No explanation.', options = {}) {
  const model = options.model || 'llama-3.3-70b-versatile';
  const max_tokens = options.max_tokens || 1024;
  const temperature = options.temperature ?? 0.3;
  try {
    const res = await getGroq().chat.completions.create({
      model, max_tokens, temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    });
    const raw = res.choices[0].message.content;
    const parsed = tryParseJSON(raw);
    if (parsed.ok) return { data: parsed.data, raw, retried: false };
    console.warn('⚠️ safeGroqJSON parse failed, retrying...', parsed.error);
    const res2 = await getGroq().chat.completions.create({
      model, max_tokens, temperature: 0.1,
      messages: [
        { role: 'system', content: 'Return ONLY a raw JSON object. No markdown. No text.' },
        { role: 'user', content: prompt },
        { role: 'assistant', content: raw },
        { role: 'user', content: 'Invalid JSON. Return ONLY the JSON object.' }
      ]
    });
    const raw2 = res2.choices[0].message.content;
    const parsed2 = tryParseJSON(raw2);
    if (parsed2.ok) return { data: parsed2.data, raw: raw2, retried: true };
    return { data: null, raw: raw2, retried: true, error: parsed2.error };
  } catch(e) { return { data: null, raw: null, retried: false, error: e.message }; }
}

export async function safeGroqText(prompt, systemPrompt = '', options = {}) {
  const model = options.model || 'llama-3.3-70b-versatile';
  const max_tokens = options.max_tokens || 1024;
  const temperature = options.temperature ?? 0.7;
  try {
    const res = await getGroq().chat.completions.create({
      model, max_tokens, temperature,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ]
    });
    return { content: res.choices[0].message.content, model: res.model, usage: res.usage };
  } catch(e) { return { content: null, error: e.message }; }
}
