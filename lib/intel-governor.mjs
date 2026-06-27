import { pool } from './db.js';
import crypto from 'crypto';

const GOVERNOR_SECRET = process.env.INGEST_SECRET || 'trunkia_intel_secret_2026';

function signProof(data) {
  return crypto.createHmac('sha256', GOVERNOR_SECRET).update(JSON.stringify(data)).digest('hex');
}

export async function runGovernor() {
  const client = await pool.connect();
  let promoted = 0;
  let rejected = 0;
  
  try {
    // 1. Fetch all quarantined items that passed security scan
    const res = await client.query(
      "SELECT * FROM intel_quarantine WHERE status = 'quarantined' AND (security_scan_result->>'has_prompt_injection')::boolean = false AND (security_scan_result->>'has_xss')::boolean = false AND (security_scan_result->>'has_sql_injection')::boolean = false ORDER BY received_at ASC LIMIT 50"
    );
    
    for (const item of res.rows) {
      try {
        // 2. Check source reputation
        const srcRes = await client.query("SELECT credibility_score, total_promoted, total_rejected FROM intel_sources_registry WHERE source_name = $1", [item.source_name]);
        const sourceRep = srcRes.rows[0];
        
        if (!sourceRep) {
          // Unknown source, reject
          await client.query("UPDATE intel_quarantine SET status = 'rejected', reviewed_at = NOW() WHERE id = $1", [item.id]);
          rejected++;
          continue;
        }
        
        // 3. Semantic duplicate check against KB
        const title = item.sanitized_content.title || '';
        if (title) {
          const dupRes = await client.query("SELECT id FROM platform_knowledge_base WHERE similarity(content->>'title', $1) > 0.7 LIMIT 1", [title]);
          if (dupRes.rows.length > 0) {
            await client.query("UPDATE intel_quarantine SET status = 'rejected', reviewed_at = NOW(), promoted_to_kb = false WHERE id = $1", [item.id]);
            rejected++;
            continue;
          }
        }
        
        // 4. Promote to Knowledge Base
        const confidence = Math.min(100, sourceRep.credibility_score);
        await client.query(
          `INSERT INTO platform_knowledge_base 
            (id, topic, knowledge_type, content, confidence_score, source_memories, times_used, last_updated, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 0, NOW(), NOW())`,
          [item.topic, item.knowledge_type, JSON.stringify(item.sanitized_content), confidence, '{' + item.source_name + '}']
        );
        
        // 5. Update quarantine status
        await client.query("UPDATE intel_quarantine SET status = 'promoted', reviewed_at = NOW(), promoted_to_kb = true WHERE id = $1", [item.id]);
        
        // 6. Update source reputation
        await client.query("UPDATE intel_sources_registry SET total_promoted = total_promoted + 1 WHERE source_name = $1", [item.source_name]);
        
        // 7. Record provenance
        const proof = signProof({ action: 'promoted', id: item.id, source: item.source_name, ts: new Date().toISOString() });
        await client.query(
          `INSERT INTO intel_provenance_chain (quarantine_id, action, actor, reason, evidence, hmac_signature, created_at)
           VALUES ($1, 'promoted', 'governor', 'Passed security and reputation checks', $2, $3, NOW())`,
          [item.id, JSON.stringify({ confidence, source_rep: sourceRep.credibility_score }), proof]
        );
        
        promoted++;
      } catch (e) {
        console.error('[GOVERNOR_ERR]', e.message);
        rejected++;
      }
    }
    
    // 8. Run Decay on KB
    await client.query("UPDATE platform_knowledge_base SET confidence_score = GREATEST(10, confidence_score - 5) WHERE knowledge_type IN ('general_ai_news', 'model_release') AND created_at < NOW() - INTERVAL '7 days' AND confidence_score > 10");
    await client.query("DELETE FROM platform_knowledge_base WHERE confidence_score < 10 AND knowledge_type NOT IN ('model_pricing', 'ai_regulation')");
    
    console.log('[GOVERNOR] Promoted=' + promoted + ' Rejected=' + rejected);
  } finally {
    client.release();
  }
}

// Self-test function
export async function governorHealthCheck() {
  const client = await pool.connect();
  try {
    const q = await client.query("SELECT COUNT(*) as cnt FROM intel_quarantine WHERE status = 'quarantined'");
    return { healthy: true, pending: parseInt(q.rows[0].cnt) };
  } finally {
    client.release();
  }
}
