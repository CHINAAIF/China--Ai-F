import dotenv from 'dotenv';
dotenv.config();
import Groq from 'groq-sdk';
import { pool } from './db.js';
import crypto from 'crypto';
import { semanticFirewall } from './semantic-firewall.js';
import { distill } from './knowledge-distiller.js';
import { generateAgentToken, verifyAgentToken, fastPath, backgroundValidate } from './gateway-sentinel.js';
import { logExecution } from './executor.js';

var groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

var MODEL_MATRIX = {
  financial:  { model: 'llama-3.3-70b-versatile', temp: 0.2, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  strategic:  { model: 'llama-3.3-70b-versatile', temp: 0.2, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  analysis:   { model: 'llama-3.3-70b-versatile', temp: 0.3, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  sovereign:  { model: 'llama-3.3-70b-versatile', temp: 0.1, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  classify:   { model: 'llama-3.1-8b-instant',    temp: 0.1, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  filter:     { model: 'llama-3.1-8b-instant',    temp: 0.1, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  summary:    { model: 'llama-3.1-8b-instant',    temp: 0.2, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
  default:    { model: 'llama-3.3-70b-versatile', temp: 0.3, heavy: 'llama-3.3-70b-versatile', light: 'llama-3.1-8b-instant' },
};

var TASK_TO_DOMAIN = {
  financial: 'ai_pricing',
  strategic: 'market_intelligence',
  analysis:  'llm_benchmarks',
  sovereign: 'ai_regulations',
};

var FALLBACK_CHAIN = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

// Escalation tier models
var ESCALATION_MODELS = {
  light: 'llama-3.1-8b-instant',
  heavy: 'llama-3.3-70b-versatile',
  verifier1: 'llama-3.3-70b-versatile',
  verifier2: 'meta-llama/llama-4-scout-17b-16e-instruct'
};

function detectTask(prompt) {
  var p = prompt.toLowerCase();
  if (p.includes('financ') || p.includes('invest') || p.includes('revenue') || p.includes('\u0633\u0639\u0631') || p.includes('\u0633\u0647\u0645') || p.includes('\u062a\u0633\u0639\u064a\u0631') || p.includes('\u062a\u0643\u0644\u0641\u0629') || p.includes('\u0645\u0627\u0644\u064a') || p.includes('\u0628\u0648\u0631\u0635\u0629') || p.includes('price') || p.includes('stock') || p.includes('cost'))  return 'financial';
  if (p.includes('strateg') || p.includes('decision') || p.includes('plan') || p.includes('\u0627\u0633\u062a\u0631\u0627\u062a\u064a\u062c') || p.includes('\u062e\u0637\u0629') || p.includes('\u0642\u0631\u0627\u0631'))  return 'strategic';
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
    await pool.query(
      'INSERT INTO judicial_routing_log (agent_name,query_hash,decision,model_selected,cache_hit,latency_ms) VALUES ($1,$2,$3,$4,$5,$6)',
      [agentName, hash, decision, model, cacheHit, latency]
    );
  } catch(_) {}
}

async function getBestModel(taskType) {
  var domain = TASK_TO_DOMAIN[taskType] || null;
  try {
    if (domain) {
      var r = await pool.query(
        'SELECT model_key FROM model_accuracy_registry WHERE domain=$1 AND sample_count>0 ORDER BY accuracy_score DESC LIMIT 1',
        [domain]
      );
      if (r.rows[0] && r.rows[0].model_key) return { model: r.rows[0].model_key, source: 'db_domain:' + domain };
    }
    var g = await pool.query(
      'SELECT model_key, AVG(accuracy_score) avg_acc FROM model_accuracy_registry WHERE sample_count>0 GROUP BY model_key ORDER BY avg_acc DESC LIMIT 1'
    );
    if (g.rows[0] && g.rows[0].model_key) return { model: g.rows[0].model_key, source: 'db_global' };
  } catch(_) {}
  return null;
}

// ========== ESCALATION ENGINE (البند 7) ==========

async function callSingleModel(prompt, modelKey, temp) {
  var res = await groq.chat.completions.create({
    model: modelKey,
    messages: [
      { role: 'system', content: 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation, no preamble.' },
      { role: 'user', content: prompt }
    ],
    temperature: temp,
    max_tokens: 1000,
  });
  var raw = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content ? res.choices[0].message.content : '';
  var clean = raw.replace(/```json|```/g, '').trim();
  var parsed;
  try {
    parsed = JSON.parse(clean);
  } catch(_) {
    var match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no_json_in_response');
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}

function extractConfidence(parsed) {
  var raw = Number(parsed && parsed.confidence);
  if (parsed && (parsed.confidence === undefined || parsed.confidence === null || isNaN(raw))) return 75;
  return Math.min(100, Math.max(0, Math.round(raw <= 1 ? raw * 100 : raw)));
}

function compareResults(primary, secondary) {
  // Simple key overlap comparison
  var keys1 = Object.keys(primary || {});
  var keys2 = Object.keys(secondary || {});
  var overlap = keys1.filter(function(k) { return keys2.indexOf(k) > -1; });
  var totalKeys = new Set(keys1.concat(keys2)).size;
  if (totalKeys === 0) return 0;
  return Math.round((overlap.length / totalKeys) * 100);
}

async function logEscalation(agentName, hash, tier, modelsUsed, agreement, finalConfidence, reason) {
  try {
    var payloadStr = JSON.stringify({
      escalation_tier: tier,
      models_used: modelsUsed,
      agreement_score: agreement,
      final_confidence: finalConfidence,
      reason: reason
    });
    var evtHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
    await pool.query(
      'INSERT INTO event_log (event_type, agent_id, payload, payload_hash, created_at) VALUES ($1,$2,$3::jsonb,$4,NOW())',
      ['escalation_decision', agentName, payloadStr, evtHash]
    );
  } catch(_) {}
}

// Tier 1: confidence 60-79 — light model verification
async function lightEscalation(prompt, primaryResult, confidence, taskType, agentName, hash) {
  var lightModel = ESCALATION_MODELS.light;
  var taskConf = MODEL_MATRIX[taskType] || MODEL_MATRIX.default;
  try {
    var secondary = await callSingleModel(prompt, lightModel, taskConf.temp);
    var agreement = compareResults(primaryResult, secondary);
    var secondaryConf = extractConfidence(secondary);

    // If light model agrees, boost confidence slightly
    // If disagrees, keep lower confidence
    var adjustedConf = confidence;
    if (agreement >= 70) {
      adjustedConf = Math.min(95, confidence + 5);
    } else if (agreement < 40) {
      adjustedConf = Math.max(30, confidence - 10);
    }

    await logEscalation(agentName, hash, 'light', [lightModel], agreement, adjustedConf, 'confidence_60_79');
    await logRouting(agentName, hash, 'escalation:light', lightModel, false, 0);

    return {
      escalated: true,
      tier: 'light',
      model: lightModel,
      agreement: agreement,
      original_confidence: confidence,
      adjusted_confidence: adjustedConf,
      secondary_confidence: secondaryConf
    };
  } catch(e) {
    await logEscalation(agentName, hash, 'light_failed', [lightModel], 0, confidence, e.message);
    return { escalated: false, reason: 'light_model_error:' + e.message };
  }
}

// Tier 2: confidence 40-59 — heavy specialized model
async function heavyEscalation(prompt, primaryResult, confidence, taskType, agentName, hash) {
  var heavyModel = ESCALATION_MODELS.heavy;
  var taskConf = MODEL_MATRIX[taskType] || MODEL_MATRIX.default;
  try {
    var secondary = await callSingleModel(prompt, heavyModel, taskConf.temp);
    var agreement = compareResults(primaryResult, secondary);
    var secondaryConf = extractConfidence(secondary);

    // Heavy model carries more weight
    var adjustedConf = Math.round((confidence + secondaryConf) / 2);
    if (agreement >= 70) {
      adjustedConf = Math.min(90, adjustedConf + 10);
    }

    await logEscalation(agentName, hash, 'heavy', [heavyModel], agreement, adjustedConf, 'confidence_40_59');
    await logRouting(agentName, hash, 'escalation:heavy', heavyModel, false, 0);

    return {
      escalated: true,
      tier: 'heavy',
      model: heavyModel,
      agreement: agreement,
      original_confidence: confidence,
      adjusted_confidence: adjustedConf,
      secondary_confidence: secondaryConf,
      secondary_data: secondary
    };
  } catch(e) {
    await logEscalation(agentName, hash, 'heavy_failed', [heavyModel], 0, confidence, e.message);
    return { escalated: false, reason: 'heavy_model_error:' + e.message };
  }
}

// Tier 3: confidence <40 — dual model verification
async function dualVerification(prompt, primaryResult, confidence, taskType, agentName, hash) {
  var m1 = ESCALATION_MODELS.verifier1;
  var m2 = ESCALATION_MODELS.verifier2;
  var taskConf = MODEL_MATRIX[taskType] || MODEL_MATRIX.default;
  try {
    var results = await Promise.allSettled([
      callSingleModel(prompt, m1, taskConf.temp),
      callSingleModel(prompt, m2, taskConf.temp)
    ]);

    var r1 = results[0].status === 'fulfilled' ? results[0].value : null;
    var r2 = results[1].status === 'fulfilled' ? results[1].value : null;

    var modelsUsed = [];
    var agreements = [];

    if (r1) {
      modelsUsed.push(m1);
      agreements.push(compareResults(primaryResult, r1));
    }
    if (r2) {
      modelsUsed.push(m2);
      agreements.push(compareResults(primaryResult, r2));
    }

    var avgAgreement = agreements.length > 0 ? Math.round(agreements.reduce(function(a, b) { return a + b; }, 0) / agreements.length) : 0;

    // If both verifiers agree with primary, boost significantly
    // If neither agrees, flag as unreliable
    var adjustedConf = confidence;
    if (agreements.length === 2 && avgAgreement >= 70) {
      adjustedConf = Math.min(85, confidence + 25);
    } else if (agreements.length === 2 && avgAgreement < 30) {
      adjustedConf = Math.max(10, confidence - 15);
    } else if (agreements.length === 1) {
      adjustedConf = Math.min(80, confidence + 10);
    }

    await logEscalation(agentName, hash, 'dual_verification', modelsUsed, avgAgreement, adjustedConf, 'confidence_below_40');
    await logRouting(agentName, hash, 'escalation:dual', modelsUsed.join(','), false, 0);

    return {
      escalated: true,
      tier: 'dual_verification',
      models: modelsUsed,
      agreements: agreements,
      avg_agreement: avgAgreement,
      original_confidence: confidence,
      adjusted_confidence: adjustedConf,
      verifier1: r1,
      verifier2: r2
    };
  } catch(e) {
    await logEscalation(agentName, hash, 'dual_failed', [], 0, confidence, e.message);
    return { escalated: false, reason: 'dual_verification_error:' + e.message };
  }
}

// Financial/Strategic: always consensus + sovereign review flag
async function consensusEscalation(prompt, primaryResult, taskType, primaryModel, agentName, hash) {
  var m2 = ESCALATION_MODELS.verifier2;
  var taskConf = MODEL_MATRIX[taskType] || MODEL_MATRIX.default;
  try {
    var secondary = await callSingleModel(prompt, m2, taskConf.temp);
    var agreement = compareResults(primaryResult, secondary);
    var secondaryConf = extractConfidence(secondary);

    var adjustedConf = Math.round((extractConfidence(primaryResult) + secondaryConf) / 2);
    if (agreement >= 70) {
      adjustedConf = Math.min(95, adjustedConf + 10);
    } else {
      adjustedConf = Math.max(40, adjustedConf - 15);
    }

    // Flag for sovereign review if disagreement
    var needsSovereignReview = agreement < 50;

    await logEscalation(agentName, hash, 'consensus', [primaryModel, m2], agreement, adjustedConf,
      'financial_strategic' + (needsSovereignReview ? ':sovereign_review_needed' : ':consensus_reached'));
    await logRouting(agentName, hash, 'escalation:consensus', m2, false, 0);

    // Log sovereign review need
    if (needsSovereignReview) {
      try {
        var revPayload = JSON.stringify({
          trigger: 'consensus_disagreement',
          task_type: taskType,
          agreement: agreement,
          primary_confidence: extractConfidence(primaryResult),
          secondary_confidence: secondaryConf,
          prompt_hash: hash
        });
        var revHash = crypto.createHash('sha256').update(revPayload, 'utf8').digest('hex');
        await pool.query(
          'INSERT INTO event_log (event_type, agent_id, payload, payload_hash, created_at) VALUES ($1,$2,$3::jsonb,$4,NOW())',
          ['sovereign_review_requested', agentName, revPayload, revHash]
        );
      } catch(_) {}
    }

    return {
      escalated: true,
      tier: 'consensus',
      models: [primaryModel, m2],
      agreement: agreement,
      adjusted_confidence: adjustedConf,
      secondary_confidence: secondaryConf,
      needs_sovereign_review: needsSovereignReview,
      secondary_data: secondary
    };
  } catch(e) {
    await logEscalation(agentName, hash, 'consensus_failed', [m2], 0, extractConfidence(primaryResult), e.message);
    return { escalated: false, reason: 'consensus_error:' + e.message };
  }
}

// Main escalation dispatcher
async function escalateDecision(prompt, parsed, confidence, taskType, primaryModel, agentName, hash) {
  // Financial/strategic: ALWAYS consensus + sovereign review
  if (taskType === 'financial' || taskType === 'strategic') {
    return await consensusEscalation(prompt, parsed, taskType, primaryModel, agentName, hash);
  }

  // Confidence >= 80: return from sovereign mind, zero extra cost
  if (confidence >= 80) return null;

  // Confidence 60-79: light model
  if (confidence >= 60) {
    return await lightEscalation(prompt, parsed, confidence, taskType, agentName, hash);
  }

  // Confidence 40-59: heavy specialized
  if (confidence >= 40) {
    return await heavyEscalation(prompt, parsed, confidence, taskType, agentName, hash);
  }

  // Confidence < 40: dual verification
  return await dualVerification(prompt, parsed, confidence, taskType, agentName, hash);
}

// ========== MAIN FUNCTION ==========

export async function safeGroqJSON(prompt, model, agentName) {
  if (!agentName) agentName = 'unknown';
  var start = Date.now();
  var hash = hashQuery(prompt);

  var token;
  try {
    token = generateAgentToken(agentName);
  } catch(e) {
    return { success: false, error: 'hmac_error:' + e.message, data: null };
  }

  try {
    var check = await semanticFirewall(prompt, agentName);
    if (!check.allowed) {
      return { success: false, error: 'blocked:' + check.threat, data: null };
    }
  } catch(_) {}

  try {
    var fast = await fastPath(hash, agentName, token);
    if (!fast.allowed) {
      return { success: false, error: 'sentinel:' + fast.reason, data: null };
    }
    if (fast.cache_hit) {
      await logRouting(agentName, hash, 'fast_path_hit', 'local', true, Date.now() - start);
      return { success: true, data: fast.data, cached: true, model: 'local', latency_ms: Date.now() - start, escalation: null };
    }
  } catch(_) {}

  var taskType = detectTask(prompt);
  var taskConf = MODEL_MATRIX[taskType];
  var temp = taskConf.temp;
  var target = model;
  var routingSource = 'manual';

  if (!target) {
    var best = await getBestModel(taskType);
    if (best) {
      target = best.model;
      routingSource = best.source;
    } else {
      target = taskConf.model;
      routingSource = 'static:' + taskType;
    }
  }

  var chain = [target];
  for (var i = 0; i < FALLBACK_CHAIN.length; i++) {
    if (FALLBACK_CHAIN[i] !== target) chain.push(FALLBACK_CHAIN[i]);
  }
  await logRouting(agentName, hash, 'routed:' + routingSource, target, false, 0);

  var lastError = null;
  var parsed = null;
  var usedModel = null;

  for (var ci = 0; ci < chain.length; ci++) {
    var m = chain[ci];
    try {
      var res = await groq.chat.completions.create({
        model: m,
        messages: [
          { role: 'system', content: 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation, no preamble.' },
          { role: 'user', content: prompt }
        ],
        temperature: temp,
        max_tokens: 1000,
      });

      var raw = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content ? res.choices[0].message.content : '';
      var clean = raw.replace(/```json|```/g, '').trim();

      try {
        parsed = JSON.parse(clean);
      } catch(_) {
        var match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('no_json_in_response');
        parsed = JSON.parse(match[0]);
      }

      usedModel = m;
      break;
    } catch(e) {
      lastError = e.message;
      continue;
    }
  }

  if (!parsed) {
    return { success: false, data: null, error: lastError };
  }

  var confidence = extractConfidence(parsed);
  var latency = Date.now() - start;

  await logRouting(agentName, hash, 'executed', usedModel, false, latency);

  // ========== ESCALATION ENGINE ==========
  var escalation = null;
  try {
    escalation = await escalateDecision(prompt, parsed, confidence, taskType, usedModel, agentName, hash);
  } catch(e) {
    // Escalation failure should not break the response
    try {
      await logEscalation(agentName, hash, 'error', [], 0, confidence, e.message);
    } catch(_) {}
  }

  // Adjust final confidence if escalation succeeded
  var finalConfidence = confidence;
  if (escalation && escalation.escalated && escalation.adjusted_confidence !== undefined) {
    finalConfidence = escalation.adjusted_confidence;
    // Update parsed confidence
    if (parsed && typeof parsed === 'object') {
      parsed._escalated = true;
      parsed._escalation_tier = escalation.tier;
      parsed._original_confidence = confidence;
      parsed.confidence = finalConfidence;
    }
  }

  // Background distill for high confidence
  if (finalConfidence >= 80) {
    backgroundValidate(agentName, hash, async function() {
      await distill(agentName, prompt, parsed, finalConfidence);
    });
  }

  return {
    success: true,
    data: parsed,
    model: usedModel,
    cached: false,
    latency_ms: Date.now() - start,
    escalation: escalation
  };
}

export default { safeGroqJSON };
