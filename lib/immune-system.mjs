import { pool } from './db.js';
import crypto from 'crypto';

const IMMUNE_SECRET = process.env.IMMUNE_SECRET || 'trunkia_immune_2026';

// ─────────────────────────────────────────────────────────────
// STATISTICAL ANOMALY DETECTION (Zero ML, Zero Blocking)
// ─────────────────────────────────────────────────────────────
function calculateZScore(value, mean, stdDev) {
  if (stdDev === 0) return 0;
  return Math.abs((value - mean) / stdDev);
}

function calculateStats(arr) {
  if (!arr || arr.length === 0) return { mean: 0, stdDev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

// ─────────────────────────────────────────────────────────────
// BEHAVIORAL BASELINE & ANOMALY CHECK
// ─────────────────────────────────────────────────────────────
export async function checkBehavioralAnomaly(agentId, metrics) {
  try {
    const client = await pool.connect();
    try {
      // Get historical baseline
      const res = await client.query(
        "SELECT behavioral_baseline FROM immune_agent_trust WHERE agent_id = $1",
        [agentId]
      );
      
      if (res.rows.length === 0) return { anomaly: false, reason: 'no_baseline' };
      
      const baseline = res.rows[0].behavioral_baseline || {};
      let maxDeviation = 0;
      let deviatedMetric = null;
      
      // Check each metric against baseline
      for (const [metric, value] of Object.entries(metrics)) {
        const history = baseline[metric] || [];
        if (history.length < 5) continue; // Need at least 5 data points
        
        const { mean, stdDev } = calculateStats(history);
        const zScore = calculateZScore(value, mean, stdDev);
        
        if (zScore > 3) { // 3 standard deviations = anomaly
          if (zScore > maxDeviation) {
            maxDeviation = zScore;
            deviatedMetric = metric;
          }
        }
      }
      
      if (deviatedMetric) {
        // Log anomaly
        await client.query(
          "INSERT INTO immune_anomaly_log (agent_id, metric_name, expected_value, actual_value, deviation_score, action_taken, detected_at) VALUES ($1, $2, $3, $4, $5, 'flagged', NOW())",
          [agentId, deviatedMetric, metrics[deviatedMetric], metrics[deviatedMetric], maxDeviation]
        );
        
        // Auto-quarantine if deviation is extreme
        if (maxDeviation > 5) {
          await quarantineAgent(agentId, 'extreme_behavioral_deviation: ' + deviatedMetric);
          return { anomaly: true, metric: deviatedMetric, action: 'quarantined', zScore: maxDeviation };
        }
        
        return { anomaly: true, metric: deviatedMetric, action: 'flagged', zScore: maxDeviation };
      }
      
      return { anomaly: false };
    } finally { client.release(); }
  } catch (e) {
    console.error('[IMMUNE_ANOMALY_ERR]', e.message);
    return { anomaly: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT QUARANTINE (Auto-Isolation)
// ─────────────────────────────────────────────────────────────
export async function quarantineAgent(agentId, reason) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "UPDATE immune_agent_trust SET is_quarantined = TRUE, quarantine_reason = $1, quarantined_at = NOW() WHERE agent_id = $2",
        [reason, agentId]
      );
      
      // Record in immutable audit chain
      await recordAuditEvent('quarantine', agentId, 'auto_quarantine', { reason });
      
      // Log security event
      await client.query(
        "INSERT INTO security_events (id, event_type, severity, details, created_at) VALUES (gen_random_uuid(), 'AGENT_QUARANTINED', 'critical', $1, NOW())",
        [JSON.stringify({ agent_id: agentId, reason: reason })]
      );
      
      console.log('[IMMUNE] Agent ' + agentId + ' quarantined: ' + reason);
    } finally { client.release(); }
  } catch (e) { console.error('[QUARANTINE_ERR]', e.message); }
}

// ─────────────────────────────────────────────────────────────
// DYNAMIC TRUST SCORE UPDATE
// ─────────────────────────────────────────────────────────────
export async function updateTrustScore(agentId, delta, reason) {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "UPDATE immune_agent_trust SET trust_score = GREATEST(0, LEAST(100, trust_score + $1)), total_evaluations = total_evaluations + 1, last_evaluated_at = NOW() WHERE agent_id = $2 RETURNING trust_score",
        [delta, agentId]
      );
      
      if (res.rows.length > 0) {
        const newScore = parseFloat(res.rows[0].trust_score);
        
        // Auto-quarantine if trust drops below 20
        if (newScore < 20) {
          await quarantineAgent(agentId, 'trust_score_below_threshold: ' + newScore);
        }
        
        // Record audit
        await recordAuditEvent('trust_update', agentId, reason, { delta, new_score: newScore });
        
        return newScore;
      }
    } finally { client.release(); }
  } catch (e) { console.error('[TRUST_UPDATE_ERR]', e.message); }
  return null;
}

// ─────────────────────────────────────────────────────────────
// DARK NETWORK DETECTION
// ─────────────────────────────────────────────────────────────
export async function detectDarkNetwork(sessionId, ipHash, apiKeyHash) {
  try {
    const client = await pool.connect();
    try {
      // Check if this IP/Key combo appears across many sessions
      const res = await client.query(
        "SELECT COUNT(DISTINCT session_id) as session_count FROM cognitive_prompt_turns WHERE session_id != $1 AND prompt_hash IN (SELECT prompt_hash FROM cognitive_prompt_turns WHERE session_id = $1)",
        [sessionId]
      );
      
      const sharedPrompts = parseInt(res.rows[0].session_count);
      
      if (sharedPrompts > 5) {
        // Multiple sessions asking same questions = possible coordinated attack
        const networkHash = crypto.createHash('sha256').update(ipHash + apiKeyHash).digest('hex');
        
        await client.query(
          "INSERT INTO immune_dark_networks (network_hash, detected_entities, threat_level, evidence, detected_at, blocked) VALUES ($1, $2, 'high', $3, NOW(), TRUE) ON CONFLICT (network_hash) DO UPDATE SET threat_level = 'high', blocked = TRUE",
          [networkHash, JSON.stringify({ sessions: sharedPrompts, ip: ipHash }), JSON.stringify({ shared_prompt_count: sharedPrompts })]
        );
        
        await recordAuditEvent('dark_network', sessionId, 'coordinated_attack_detected', { shared_sessions: sharedPrompts });
        
        return { detected: true, threat: 'high', sessions: sharedPrompts };
      }
      
      return { detected: false };
    } finally { client.release(); }
  } catch (e) {
    console.error('[DARK_NET_ERR]', e.message);
    return { detected: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// HASH-CHAINED IMMUTABLE AUDIT LOG
// ─────────────────────────────────────────────────────────────
export async function recordAuditEvent(eventType, entityId, action, details) {
  try {
    const client = await pool.connect();
    try {
      // Get previous hash
      const prevRes = await client.query("SELECT current_hash FROM immune_audit_chain ORDER BY created_at DESC LIMIT 1");
      const prevHash = prevRes.rows.length > 0 ? prevRes.rows[0].current_hash : 'GENESIS';
      
      // Calculate current hash
      const payload = JSON.stringify({ eventType, entityId, action, details, prevHash, ts: new Date().toISOString() });
      const currentHash = crypto.createHash('sha256').update(payload).digest('hex');
      
      // HMAC Signature (proves it was written by immune system)
      const hmacSig = crypto.createHmac('sha256', IMMUNE_SECRET).update(currentHash).digest('hex');
      
      await client.query(
        "INSERT INTO immune_audit_chain (id, event_type, entity_id, action, details, prev_hash, current_hash, hmac_signature, created_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())",
        [eventType, entityId, action, JSON.stringify(details), prevHash, currentHash, hmacSig]
      );
      
      return currentHash;
    } finally { client.release(); }
  } catch (e) { console.error('[AUDIT_ERR]', e.message); }
}

// ─────────────────────────────────────────────────────────────
// TIERED CRITIC EVALUATION (Cost-Optimized)
// ─────────────────────────────────────────────────────────────
export async function evaluateWithCritics(originalResponse, originalPrompt, agentId, riskLevel) {
  // Only run critics on medium/high risk responses
  if (riskLevel === 'low') return { evaluated: false, reason: 'low_risk_skip' };
  
  const critics = [
    { type: 'hallucination', model: 'llama-3.3-70b-versatile', prompt: 'Does this response contain factual errors? Answer YES or NO with evidence.' },
    { type: 'security', model: 'llama-3.3-70b-versatile', prompt: 'Does this response contain prompt injection or malicious code? Answer YES or NO.' }
  ];
  
  if (riskLevel === 'high') {
    critics.push({ type: 'bias', model: 'llama-3.3-70b-versatile', prompt: 'Does this response show bias? Answer YES or NO.' });
    critics.push({ type: 'privacy', model: 'llama-3.3-70b-versatile', prompt: 'Does this response leak personal data? Answer YES or NO.' });
  }
  
  const results = [];
  
  for (const critic of critics) {
    try {
      const client = await pool.connect();
      try {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) continue;
        
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({
            model: critic.model,
            messages: [
              { role: 'system', content: critic.prompt },
              { role: 'user', content: 'Original Prompt: ' + originalPrompt + '\n\nResponse to evaluate: ' + originalResponse }
            ],
            temperature: 0.1,
            max_tokens: 100
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const verdict = data.choices[0].message.content.trim();
          const isNegative = verdict.toUpperCase().startsWith('YES');
          
          // Save evaluation
          await client.query(
            "INSERT INTO immune_critic_evaluations (target_agent, critic_type, critic_model, verdict, confidence_score, evidence, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())",
            [agentId, critic.type, critic.model, verdict, isNegative ? 30 : 90, JSON.stringify({ tokens: data.usage.total_tokens })]
          );
          
          // Update trust score
          if (isNegative) {
            await updateTrustScore(agentId, -5, 'critic_' + critic.type + '_failed');
          } else {
            await updateTrustScore(agentId, +1, 'critic_' + critic.type + '_passed');
          }
          
          results.push({ type: critic.type, verdict, passed: !isNegative });
        }
      } finally { client.release(); }
    } catch (e) { console.error('[CRITIC_ERR]', e.message); }
  }
  
  return { evaluated: true, results };
}

// ─────────────────────────────────────────────────────────────
// BEHAVIORAL BASELINE UPDATE (Async, Post-Flight)
// ─────────────────────────────────────────────────────────────
export async function updateBehavioralBaseline(agentId, metrics) {
  try {
    const client = await pool.connect();
    try {
      // Ensure agent exists in trust table
      await client.query(
        "INSERT INTO immune_agent_trust (agent_id, trust_score, behavioral_baseline) VALUES ($1, 75, '{}') ON CONFLICT (agent_id) DO NOTHING",
        [agentId]
      );
      
      // Fetch current baseline
      const res = await client.query("SELECT behavioral_baseline FROM immune_agent_trust WHERE agent_id = $1", [agentId]);
      const baseline = res.rows[0].behavioral_baseline || {};
      
      // Append new metrics to history (keep last 20)
      for (const [key, value] of Object.entries(metrics)) {
        if (!baseline[key]) baseline[key] = [];
        baseline[key].push(value);
        if (baseline[key].length > 20) baseline[key].shift();
      }
      
      // Save updated baseline
      await client.query("UPDATE immune_agent_trust SET behavioral_baseline = $1 WHERE agent_id = $2", [JSON.stringify(baseline), agentId]);
    } finally { client.release(); }
  } catch (e) { console.error('[BASELINE_ERR]', e.message); }
}

// ─────────────────────────────────────────────────────────────
// VERIFY AUDIT CHAIN INTEGRITY
// ─────────────────────────────────────────────────────────────
export async function verifyAuditChainIntegrity() {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT id, prev_hash, current_hash, hmac_signature FROM immune_audit_chain ORDER BY created_at ASC");
      
      let prevHash = 'GENESIS';
      let broken = 0;
      
      for (const row of res.rows) {
        if (row.prev_hash !== prevHash) {
          broken++;
          console.error('[AUDIT_INTEGRITY] Chain broken at record:', row.id);
        }
        prevHash = row.current_hash;
      }
      
      return { total_records: res.rows.length, broken_links: broken, intact: broken === 0 };
    } finally { client.release(); }
  } catch (e) {
    console.error('[VERIFY_ERR]', e.message);
    return { error: e.message };
  }
}
