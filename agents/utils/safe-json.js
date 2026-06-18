import dotenv from 'dotenv';
dotenv.config();
import Groq from 'groq-sdk';
import pg from 'pg';
import crypto from 'crypto';
import { semanticFirewall } from './semantic-firewall.js';
import { distill } from './knowledge-distiller.js';
import { generateAgentToken, verifyAgentToken, fastPath, backgroundValidate } from './gateway-sentinel.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MODEL_MATRIX = {
  financial:  { model: 'llama-3.3-70b-versatile', temp: 0.2 },
  strategic:  { model: 'llama-3.3-70b-versatile', temp: 0.2 },
  analysis:   { model: 'llama-3.3-70b-versatile', temp: 0.3 },
  sovereign:  { model: 'llama-3.3-70b-versatile', temp: 0.1 },
  classify:   { model: 'llama-3.1-8b-instant',    temp: 0.1 },
  filter:     { model: 'llama-3.1-8b-instant',    temp: 0.1 },
  summary:    { model: 'llama-3.1-8b-instant',    temp: 0.2 },
  default:    { model: 'llama-3.3-70b-versatile', temp: 0.3 },
};

const FALLBACK_CHAIN = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

function detectTask(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('financ') || p.includes('invest') || p.includes('revenue'))  return 'financial';
  if (p.includes('strateg') || p.includes('decision') || p.includes('plan'))  return 'strategic';
  if (p.includes('analyz') || p.includes('trend') || p.includes('signal'))    return 'analysis';
  if (p.includes('sovereign') || p.includes('veto') || p.includes('govern'))  return 'sovereign';
  if (p.includes('classif') || p.includes('sort') || p.includes('categ'))     return 'classify';
  if (p.includes('summar') || p.includes('digest') || p.includes('brief'))    return 'summary';
  return 'default';
}

function hashQuery(text) {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 64);
}

async function logRouting(agentName, hash, decision, model, cacheHit, latency) {
  try {
    await pool.query(`
      INSERT INTO judicial_routing_log
        (agent_name,query_hash,decision,model_selected,cache_hit,latency_ms)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [agentName, hash, decision, model, cacheHit, latency]);
  } catch(_) {}
}

export async function safeGroqJSON(prompt, model = null, agentName = 'unknown') {
  const start = Date.now();
  const hash  = hashQuery(prompt);

  // ── 1. HMAC Token توليد فقط — fastPath يتحقق هو ──────────
  let token;
  try {
    token = generateAgentToken(agentName);
  } catch(e) {
    return { success: false, error: `hmac_error:${e.message}`, data: null };
  }

  // ── 2. Semantic Firewall ──────────────────────────────────
  try {
    const check = await semanticFirewall(prompt, agentName);
    if (!check.allowed) {
      return { success: false, error: `blocked:${check.threat}`, data: null };
    }
  } catch(_) {}

  // ── 3. Fast-Path Cache via Sentinel ──────────────────────
  try {
    const fast = await fastPath(hash, agentName, token);
    if (!fast.allowed) {
      return { success: false, error: `sentinel:${fast.reason}`, data: null };
    }
    if (fast.cache_hit) {
      await logRouting(agentName, hash, 'fast_path_hit', 'local', true, Date.now()-start);
      return { success: true, data: fast.data, cached: true, model: 'local', latency_ms: Date.now()-start };
    }
  } catch(_) {}

  // ── 4. Judicial Routing ───────────────────────────────────
  const taskType = detectTask(prompt);
  const { model: routedModel, temp } = MODEL_MATRIX[taskType];
  const target   = model || routedModel;
  const chain    = [target, ...FALLBACK_CHAIN.filter(m => m !== target)];

  await logRouting(agentName, hash, `routed:${taskType}`, target, false, 0);

  // ── 5. Execution + Background Validation ─────────────────
  let lastError = null;
  for (const m of chain) {
    try {
      const res = await groq.chat.completions.create({
        model: m,
        messages: [
          {
            role: 'system',
            content: 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation, no preamble.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: temp,
        max_tokens: 1000,
      });

      const raw   = res.choices?.[0]?.message?.content || '';
      const clean = raw.replace(/```json|```/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch(_) {
        const match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('no_json_in_response');
        parsed = JSON.parse(match[0]);
      }

      const confidence = Math.min(100, Math.max(0, Math.round(parsed?.confidence ?? 75)));
      const latency    = Date.now() - start;

      await logRouting(agentName, hash, 'executed', m, false, latency);

      // ── 6. Background Distillation — لا ينتظر ────────────
      if (confidence >= 80) {
        backgroundValidate(agentName, hash, async () => {
          await distill(agentName, prompt, parsed, confidence);
        });
      }

      return { success: true, data: parsed, model: m, cached: false, latency_ms: latency };

    } catch(e) {
      lastError = e.message;
      continue;
    }
  }

  return { success: false, data: null, error: lastError };
}

export default { safeGroqJSON };
