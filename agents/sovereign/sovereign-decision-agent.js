/**
 * TRUNKIA Sovereign Decision Agent (SDP/1.0)
 * 4D Decision Matrix: Confidence + Consequence + Reversibility + Ledger
 * The inner heart of the system.
 */
import { BaseAgent } from '../base-agent.js';
import { queryData, mutateData } from '../../lib/tools/sql-tool.js';
import { readMemory, writeMemory } from '../../lib/blackboard.js';
import crypto from 'crypto';

const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-secret';

// عتبات الثقة (Confidence Thresholds)
const THRESHOLDS = {
  PUBLISH: 75,    // نشر للمستخدم
  ARCHIVE: 50,    // أرشفة فقط
  DEFER: 30,      // تأجيل
  REVERSE_BUMP: 20 // فارق الثقة المطلوب لعكس قرار
};

class SovereignDecisionAgent extends BaseAgent {
  constructor() {
    super('sovereign_decision', 'sovereign');
    this.lastDecisionHash = null; // رابط السلسلة
  }

  async run() {
    try {
      // 1. التحقق الذاتي من سلسلة TPAV (لا نثق بالإشارة)
      const verificationSignal = await readMemory('analysis:verification_complete');
      if (!verificationSignal) {
        return { success: true, message: 'No verified analyses. Decision agent resting.' };
      }

      // 2. جلب التحليلات التي نجت من التحقق العدائي (System Origin, Read-Only)
      const sql = `SELECT id, title, raw_content, 
                          metadata->'strategic_analysis' as analysis,
                          metadata->'verification' as verification
                   FROM intelligence_raw 
                   WHERE metadata->'verification'->'verdict' = 'SURVIVED'
                   AND metadata->'sovereign_decision' IS NULL
                   ORDER BY collected_at DESC LIMIT 1`;
      
      const readIntent = { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' };
      const dbResult = await queryData(sql, [], 'intelligence', this.name, 'sovereign_system', readIntent);
      
      if (!dbResult.success || dbResult.rows.length === 0) {
        return { success: true, message: 'No survived analyses awaiting decision.' };
      }

      const item = dbResult.rows[0];
      const analysis = item.analysis;
      const verification = item.verification;

      // 3. التحقق من سلسلة TPAV بنفسنا (لا نثق بأحد)
      if (!this._verifyTPAVChain(verification)) {
        console.error(`[SOVEREIGN DECISION] TPAV Chain verification FAILED for item ${item.id}. Rejecting.`);
        return { success: false, error: 'TPAV chain tampered.' };
      }

      // 4. حساب درجة الثقة السيادية (SCS) - رياضياً، وليس بالـ LLM
      const tpavConfidence = verification.confidence || 50;
      const sourceReputation = await this._getSourceReputation(item.id);
      const analystHistory = await this._getAnalystHistory();
      const trendMomentum = await this._getTrendMomentum(analysis?.trend);

      const scs = Math.round(
        (tpavConfidence * 0.4) + 
        (sourceReputation * 0.3) + 
        (analystHistory * 0.2) + 
        (trendMomentum * 0.1)
      );

      // 5. تحليل العواقب (Consequence Analysis) عبر LLM
      const consequencePrompt = `You are a risk assessor. A strategic analysis says: "${analysis?.trend || 'Unknown'}"
What are the consequences of ACTING on this analysis? What are the consequences of being WRONG?
Return JSON ONLY: {"consequence_severity": "low|medium|high|critical", "wrong_cost": "..."}`;

      const consequenceResult = await this.think(consequencePrompt, 'You are a risk assessment AI.');
      if (consequenceResult.error || !consequenceResult.data) {
        return { success: false, error: 'Consequence analysis failed.' };
      }

      const consequence = consequenceResult.data;
      const severity = consequence.consequence_severity || 'medium';

      // 6. تعديل العتبة بناءً على خطورة العواقب
      let effectiveThreshold = THRESHOLDS.ARCHIVE;
      if (severity === 'high') effectiveThreshold = THRESHOLDS.PUBLISH;
      if (severity === 'critical') effectiveThreshold = 90; // عتبة كارثية

      // 7. اتخاذ القرار (رياضياً، ليس بالـ LLM)
      let decision;
      if (scs >= effectiveThreshold && scs >= THRESHOLDS.PUBLISH) {
        decision = 'PUBLISH';
      } else if (scs >= THRESHOLDS.ARCHIVE) {
        decision = 'ARCHIVE';
      } else if (scs >= THRESHOLDS.DEFER) {
        decision = 'DEFER';
      } else {
        decision = 'REJECT';
      }

      // 8. بناء سلسلة القرار السيادي (Sovereign Decision Chain)
      const chain = [];
      
      const block1 = this._createBlock('EVIDENCE', {
        item_id: item.id,
        tpav_confidence: tpavConfidence,
        source_reputation: sourceReputation,
        analyst_history: analystHistory,
        trend_momentum: trendMomentum
      }, this.lastDecisionHash);
      chain.push(block1);

      const block2 = this._createBlock('CONSEQUENCE', {
        severity: severity,
        wrong_cost: consequence.wrong_cost?.substring(0, 100),
        effective_threshold: effectiveThreshold
      }, block1.hash);
      chain.push(block2);

      const block3 = this._createBlock('DECISION', {
        decision: decision,
        scs: scs,
        reason: `SCS=${scs}, Threshold=${effectiveThreshold}, Severity=${severity}`
      }, block2.hash);
      block3.signature = this._sign(block3.hash);
      chain.push(block3);

      // 9. تحديث الـ DB بالقرار السيادي (Sovereign Write)
      const decisionRecord = {
        decision,
        scs,
        severity,
        threshold: effectiveThreshold,
        chain,
        decided_at: Date.now(),
        decision_model: consequenceResult.model
      };

      const updateSql = `UPDATE intelligence_raw SET metadata = jsonb_set(metadata, '{sovereign_decision}', $1::jsonb) WHERE id = $2`;
      const updateParams = [JSON.stringify(decisionRecord), item.id];
      const writeIntent = { agentName: this.name, userId: 'sovereign_system', action: 'execute_sql_write', layer: 'sovereign', origin: 'system', table: 'intelligence_raw' };
      
      const writeResult = await mutateData(updateSql, updateParams, 'intelligence', this.name, 'sovereign_system', writeIntent);
      if (!writeResult.success) {
        return { success: false, error: 'Failed to record sovereign decision.' };
      }

      // 10. تحديث رابط السلسلة للقرار التالي
      this.lastDecisionHash = block3.hash;

      // 11. البث المعرفي: إيقاظ طبقة التنفيذ
      if (decision === 'PUBLISH') {
        await writeMemory('sovereign:publish_decision', {
          item_id: item.id,
          title: item.title,
          decision: decision,
          scs: scs,
          timestamp: Date.now()
        }, 3600);
      }

      return { 
        success: true, 
        decision, 
        scs, 
        severity,
        chain_verified: true,
        chain_length: chain.length
      };

    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * التحقق من سلسلة TPAV بنفسه (لا يثق بالإشارة)
   */
  _verifyTPAVChain(verification) {
    if (!verification || !verification.chain) return false;
    
    let prevHash = null;
    for (const block of verification.chain) {
      if (block.prev_hash !== prevHash) return false;
      const payload = JSON.stringify({ step: block.step, data: block.data, prev_hash: block.prev_hash, timestamp: block.timestamp });
      const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
      if (block.hash !== expectedHash) return false;
      prevHash = block.hash;
    }
    
    // التحقق من التوقيع النهائي
    const finalBlock = verification.chain[verification.chain.length - 1];
    if (finalBlock.signature) {
      const expectedSig = crypto.createHmac('sha256', PROTOCOL_SECRET).update(finalBlock.hash).digest('hex');
      if (finalBlock.signature !== expectedSig) return false;
    }
    
    return true;
  }

  /**
   * سمعة المصدر (0-100)
   */
  async _getSourceReputation(itemId) {
    try {
      const sql = `SELECT COALESCE(AVG(reputation_score), 50) as avg_rep 
                   FROM source_reputation 
                   WHERE domain_url IN (
                     SELECT metadata->>'source_domain' 
                     FROM intelligence_raw 
                     WHERE id = $1
                   )`;
      const result = await queryData(sql, [itemId], 'intelligence', this.name, 'sovereign_system', 
        { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' });
      return result.success && result.rows.length > 0 ? Math.min(100, Math.max(0, parseInt(result.rows[0].avg_rep || 50))) : 50;
    } catch (e) {
      return 50;
    }
  }

  /**
   * تاريخ دقة المحلل (0-100)
   */
  async _getAnalystHistory() {
    try {
      const sql = `SELECT COUNT(*) FILTER (WHERE metadata->'verification'->>'verdict' = 'SURVIVED') as survived,
                          COUNT(*) as total
                   FROM intelligence_raw 
                   WHERE metadata->'strategic_analysis' IS NOT NULL`;
      const result = await queryData(sql, [], 'intelligence', this.name, 'sovereign_system',
        { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' });
      
      if (result.success && result.rows.length > 0) {
        const survived = parseInt(result.rows[0].survived || 0);
        const total = parseInt(result.rows[0].total || 1);
        return total > 0 ? Math.round((survived / total) * 100) : 50;
      }
      return 50;
    } catch (e) {
      return 50;
    }
  }

  /**
   * زخمية الاتجاه (0-100)
   */
  async _getTrendMomentum(trend) {
    if (!trend) return 50;
    try {
      const sql = `SELECT COUNT(*) as count FROM intelligence_raw 
                   WHERE metadata->'strategic_analysis'->>'trend' = $1
                   AND collected_at > NOW() - INTERVAL '24 hours'`;
      const result = await queryData(sql, [trend], 'intelligence', this.name, 'sovereign_system',
        { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' });
      
      if (result.success && result.rows.length > 0) {
        const count = parseInt(result.rows[0].count || 0);
        return Math.min(100, count * 20); // كل إشارة = 20 نقطة، حد أقصى 100
      }
      return 50;
    } catch (e) {
      return 50;
    }
  }

  _createBlock(step, data, prevHash) {
    const timestamp = Date.now();
    const payload = JSON.stringify({ step, data, prev_hash: prevHash, timestamp });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return { step, data, prev_hash: prevHash, timestamp, hash };
  }

  _sign(hash) {
    return crypto.createHmac('sha256', PROTOCOL_SECRET).update(hash).digest('hex');
  }
}

export const sovereignDecisionAgent = new SovereignDecisionAgent();
export default sovereignDecisionAgent;
