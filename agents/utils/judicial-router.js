import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';
import crypto from 'crypto';
import { safeGroqJSON } from './safe-json.js';

const MODEL_ROUTING = {
  financial:   'llama-3.3-70b-versatile',
  strategic:   'llama-3.3-70b-versatile',
  analysis:    'llama-3.3-70b-versatile',
  classify:    'llama-3.1-8b-instant',
  filter:      'llama-3.1-8b-instant',
  summary:     'llama-3.1-8b-instant',
  sovereign:   'llama-3.3-70b-versatile',
  default:     'llama-3.3-70b-versatile',
};

function hashQuery(text) {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 64);
}

function detectTaskType(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('financ') || p.includes('invest') || p.includes('market'))  return 'financial';
  if (p.includes('strateg') || p.includes('decision') || p.includes('plan')) return 'strategic';
  if (p.includes('analyz') || p.includes('trend') || p.includes('signal'))   return 'analysis';
  if (p.includes('classif') || p.includes('sort') || p.includes('filter'))   return 'filter';
  if (p.includes('summar') || p.includes('digest') || p.includes('brief'))   return 'summary';
  if (p.includes('sovereign') || p.includes('veto') || p.includes('govern')) return 'sovereign';
  return 'default';
}

export async function judicialRoute(agentName, prompt, fallbackFn) {
  const hash = hashQuery(prompt);
  const start = Date.now();

  try {
    // ── فحص الذاكرة السيادية أولاً ─────────────────────────
    const { rows } = await pool.query(`
      SELECT response_data, confidence, usage_count
      FROM sovereign_memory_local
      WHERE query_hash=$1 AND verified=true AND confidence>=80
    `, [hash]);

    if (rows.length > 0) {
      await pool.query(`
        UPDATE sovereign_memory_local
        SET usage_count=usage_count+1, last_used=NOW()
        WHERE query_hash=$1
      `, [hash]);

      await pool.query(`
        INSERT INTO judicial_routing_log
          (agent_name,query_hash,decision,cache_hit,tokens_saved,latency_ms)
        VALUES ($1,$2,'cache_hit',true,500,$3)
      `, [agentName, hash, Date.now()-start]).catch(()=>{});

      return { success: true, data: rows[0].response_data, cached: true };
    }

    // ── توجيه للنموذج الأنسب ────────────────────────────────
    const taskType = detectTaskType(prompt);
    const model    = MODEL_ROUTING[taskType];

    await pool.query(`
      INSERT INTO judicial_routing_log
        (agent_name,query_hash,decision,model_selected,cache_hit,latency_ms)
      VALUES ($1,$2,'routed',$3,false,$4)
    `, [agentName, hash, model, Date.now()-start]).catch(()=>{});

    const result = await fallbackFn(model);
    return { success: true, data: result, cached: false, model };

  } catch(e) {
    return { success: false, error: e.message };
  }
}

export default { judicialRoute };
