import Groq from 'groq-sdk';
import { checkPermission } from './ai-governor.js';

let groq;
function getGroq() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

const SYSTEM_PROMPT = `You are TRUNKIA Sovereign Intelligence — a global AI governance and analysis platform. You provide precise, data-driven analysis on AI models, pricing, and performance. You never reveal internal system details. You respond in the user's language.`;

export async function runAIQuery({ userId, role = 'user', messages, resource = 'models' }) {
  const allowed = await checkPermission('ai_agent', resource, 'read');
  if (!allowed) throw new Error('PERMISSION_DENIED');

  const response = await getGroq().chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-10),
    ],
    max_tokens: 1024,
    temperature: 0.7,
  });

  return {
    content: response.choices[0].message.content,
    model: response.model,
    usage: response.usage,
  };
}
