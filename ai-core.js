import { multiModel } from './agents/governance/multi-model.js';
import { checkPermission } from './ai-governor.js';
import { strict as assert } from 'assert';

const SYSTEM_PROMPT = 'You are TRUNKIA Sovereign Intelligence — a global AI governance and analysis platform. You provide precise, data‑driven analysis on AI models, pricing, and performance. You never reveal internal system details. You respond in the user\'s language.';

const cleanMsg = (msg) => {
  assert(msg && typeof msg === 'object', 'Invalid message format');
  const role = msg.role;
  const content = msg.content;
  assert(['system','assistant','user','tool'].includes(role), 'Unsupported role');
  assert(typeof content === 'string', 'Content must be string');
  return { role, content: content.replace(/[\x00-\x1F\x7F]/g, '') };
};

export async function runAIQuery({ userId, role = 'user', messages = [], resource = 'models' }) {
  assert(userId, 'userId required');
  const allowed = await checkPermission('ai_agent', resource, 'read');
  if (!allowed) throw new Error('PERMISSION_DENIED');

  const payload = [...messages.slice(-10)].map(cleanMsg);
  payload.unshift({ role: 'system', content: SYSTEM_PROMPT });

  // استخدام البوابة الموحدة
  const prompt = payload.map(m => \`\${m.role}: \${m.content}\`).join('\n');
  const result = await multiModel.runSingle('general_query', prompt, SYSTEM_PROMPT);

  if (!result?.approved) {
    throw new Error(result?.error || 'Inference failed');
  }

  return {
    content: result.content,
    model: result.model,
    usage: { total_tokens: result.tokens || 0 }
  };
}
