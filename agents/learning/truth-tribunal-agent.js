/**
 * TRUNKIA Sovereign Truth Tribunal
 * Implements: Deterministic Anchoring, Dialectical Antagonism, and Source Reputation Binding.
 */
import { getPool, generateDbToken } from '../../lib/db.js';
import { multiModel } from '../governance/multi-model.js';
import crypto from 'crypto';

const pool = getPool('learning', generateDbToken('agents/learning/truth-tribunal-agent.js'));

class TruthTribunalAgent {
  constructor() {
    this.name = 'truth_tribunal';
    this.layer = 'learning';
    this.status = 'active';
  }

  async run() {
    try {
      // 1. Fetch unverified items
      const items = await pool.query(`
        SELECT ir.id, ir.raw_content, ir.source_id, ir.signals
        FROM intelligence_raw ir
        WHERE ir.filter_status = 'passed' 
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_verified iv WHERE iv.raw_id = ir.id AND iv.published = true
        )
        LIMIT 5
      `);

      if (!items.rows.length) return { success: true, message: 'No items to judge.' };

      let judged = 0;
      let published = 0;

      for (const item of items.rows) {
        // 2. Deterministic Anchor: Check Source Reputation
        const sourceRes = await pool.query('SELECT reliability_score FROM intelligence_sources WHERE id = $1', [item.source_id]);
        const reliability = sourceRes.rows[0]?.reliability_score || 0;

        if (reliability < 30) {
          await this._recordVerdict(item.id, 'rejected', 'Source reliability below threshold (Deterministic).');
          judged++;
          continue;
        }

        // 3. Consensus Quorum: Ask two models
        const prompt = `Analyze this intelligence data. Is it plausible and internally consistent? Respond ONLY with JSON: {"plausible": true/false, "reason": "..."}. Data: ${item.raw_content.substring(0, 500)}`;
        
        const model1Res = await multiModel.runSingle('verification', prompt, 'You are a strict data analyst.');
        const model2Res = await multiModel.runSingle('verification', prompt, 'You are a skeptical intelligence auditor.');

        const m1Plausible = model1Res.approved && model1Res.content?.includes('"plausible": true');
        const m2Plausible = model2Res.approved && model2Res.content?.includes('"plausible": true');

        if (!m1Plausible || !m2Plausible) {
          await this._recordVerdict(item.id, 'rejected', 'Consensus not reached.');
          judged++;
          continue;
        }

        // 4. Dialectical Antagonist: Try to falsify the consensus
        const falsificationPrompt = `Here is a piece of intelligence data. Your task is to find ANY logical flaw, factual error, or reason why it is FALSE. If you cannot find any flaw, admit it is true. Respond ONLY with JSON: {"is_false": true/false, "flaw": "..."}. Data: ${item.raw_content.substring(0, 500)}`;
        const falsifierRes = await multiModel.runSingle('verification', falsificationPrompt, 'You are a ruthless fact-checker looking for lies.');
        
        const isFalse = falsifierRes.approved && falsifierRes.content?.includes('"is_false": true');

        if (isFalse) {
          await this._recordVerdict(item.id, 'rejected', 'Falsified by Dialectical Antagonist.');
          judged++;
          continue;
        }

        // 5. Publish with Sovereign Seal
        await this._recordVerdict(item.id, 'published', 'Passed Triadic Verification.');
        judged++;
        published++;

      }

      return { success: true, judged, published };

    } catch (e) {
      if (e.message.includes('timeout') || e.message.includes('Connection terminated')) {
        console.warn('[TruthTribunal] DB Unreachable. Entering Graceful Degradation.');
        return { success: true, status: 'degraded', message: 'Database is currently unreachable. Tribunal paused.' };
      }
      console.error('[TruthTribunal] Error:', e.message);
      return { success: false, error: e.message };
    }
  }

  // Append-Only Verdict Recording with HMAC Seal
  async _recordVerdict(rawId, verdict, reason) {
    const seal = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(`${rawId}:${verdict}`).digest('hex');
    
    // Insert into verified table (Append-Only approach)
    await pool.query(`
      INSERT INTO intelligence_verified (raw_id, verified_content, published, impact_level)
      VALUES ($1, $2, $3, 'low')
      ON CONFLICT DO NOTHING
    `, [
      rawId,
      JSON.stringify({ verdict, reason, seal, timestamp: new Date().toISOString() }),
      verdict === 'published'
    ]);
  }
}

export const truthTribunalAgent = new TruthTribunalAgent();
export default truthTribunalAgent;
