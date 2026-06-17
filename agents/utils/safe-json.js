import dotenv from 'dotenv';
dotenv.config();
import Groq from 'groq-sdk';
import { semanticFirewall } from './semantic-firewall.js';
import { distill } from './knowledge-distiller.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

export async function safeGroqJSON(prompt, model = null, agentName = 'unknown') {
  // ── Semantic Firewall على الـprompt ─────────────────────
  try {
    const check = await semanticFirewall(prompt, agentName);
    if (!check.allowed) {
      return { success: false, error: `blocked:${check.threat}`, data: null };
    }
  } catch(_) {}

  const targetModel = model || MODELS[0];
  let lastError = null;

  for (const m of [targetModel, ...MODELS.filter(x => x !== targetModel)]) {
    try {
      const res = await groq.chat.completions.create({
        model: m,
        messages: [
          {
            role: 'system',
            content: 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const raw = res.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json|```/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch(_) {
        const match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('no_json');
        parsed = JSON.parse(match[0]);
      }

      const confidence = Math.min(100, Math.max(0, Math.round(parsed?.confidence ?? 75)));

      // ── Knowledge Distiller على كل نجاح ─────────────────
      if (confidence >= 80) {
        distill(agentName, prompt, parsed, confidence).catch(() => {});
      }

      return { success: true, data: parsed, model: m, error: null };

    } catch(e) {
      lastError = e.message;
      continue;
    }
  }

  return { success: false, data: null, error: lastError };
}

export default { safeGroqJSON };
