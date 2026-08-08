/**
 * TRUNKIA Cognitive Government (CSOP/1.0)
 * Tri-Cameral Cognitive Separation of Powers.
 * No single agent has absolute power. Mutual Oversight.
 */
import { queryData, mutateData } from './tools/sql-tool.js';
import { readMemory, writeMemory } from './blackboard.js';
import { multiModel } from '../agents/governance/multi-model.js';
import crypto from 'crypto';

const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-secret';

class CognitiveGovernment {
  constructor() {
    this.legislature = new CognitiveLegislature();
    this.executive = new CognitiveExecutive();
    this.judiciary = new CognitiveJudiciary();
  }

  /**
   * المعالجة الكاملة للقرار السيادي
   */
  async processDecision(itemId) {
    const auditTrail = [];

    // 1. السلطة التشريعية: استخراج القوانين المعرفية
    const laws = await this.legislature.getActiveLaws(itemId);
    const lawBlock = this._createBlock('LEGISLATURE', { laws_active: laws.length, law_types: laws.map(l => l.type) }, null);
    auditTrail.push(lawBlock);

    // 2. السلطة التنفيذية: اتخاذ القرار بناءً على القوانين
    const executiveDecision = await this.executive.decide(itemId, laws);
    if (!executiveDecision.success) throw new Error('Executive failed to decide.');
    
    const execBlock = this._createBlock('EXECUTIVE', {
      decision: executiveDecision.decision,
      reasoning: executiveDecision.reasoning,
      confidence: executiveDecision.confidence,
      model_used: executiveDecision.model
    }, lawBlock.hash);
    auditTrail.push(execBlock);

    // 3. السلطة القضائية: مراجعة دستورية للقرار
    const judicialReview = await this.judiciary.review(executiveDecision, laws, itemId);
    
    const judBlock = this._createBlock('JUDICIARY', {
      verdict: judicialReview.verdict,
      violations: judicialReview.violations,
      override: judicialReview.override,
      reviewer_model: judicialReview.model
    }, execBlock.hash);
    
    if (judicialReview.override) {
      judBlock.signature = this._sign(judBlock.hash + 'OVERRIDE');
    } else {
      judBlock.signature = this._sign(judBlock.hash);
    }
    auditTrail.push(judBlock);

    // 4. القرار النهائي (الإعدام أو الإلغاء)
    const finalDecision = judicialReview.override ? 'OVERTURNED' : executiveDecision.decision;
    const finalConfidence = judicialReview.override ? 0 : executiveDecision.confidence;

    // 5. كتابة القرار في الـ DB (Sovereign Write)
    const decisionRecord = {
      final_decision: finalDecision,
      confidence: finalConfidence,
      government_chain: auditTrail,
      overturned_by: judicialReview.override ? 'JUDICIARY' : null,
      violations: judicialReview.violations,
      decided_at: Date.now()
    };

    const updateSql = `UPDATE intelligence_raw SET metadata = jsonb_set(metadata, '{sovereign_decision}', $1::jsonb) WHERE id = $2`;
    const updateParams = [JSON.stringify(decisionRecord), itemId];
    const writeIntent = { agentName: 'cognitive_government', userId: 'sovereign_system', action: 'execute_sql_write', layer: 'sovereign', origin: 'system', table: 'intelligence_raw' };
    
    const writeResult = await mutateData(updateSql, updateParams, 'intelligence', 'cognitive_government', 'sovereign_system', writeIntent);
    if (!writeResult.success) throw new Error('Failed to write sovereign decision.');

    // 6. البث المعرفي
    if (finalDecision === 'PUBLISH') {
      await writeMemory('sovereign:publish_decision', { item_id: itemId, timestamp: Date.now() }, 3600);
    }

    return {
      success: true,
      final_decision: finalDecision,
      confidence: finalConfidence,
      overturned: judicialReview.override,
      violations: judicialReview.violations,
      chain: auditTrail
    };
  }

  _createBlock(branch, data, prevHash) {
    const timestamp = Date.now();
    const payload = JSON.stringify({ branch, data, prev_hash: prevHash, timestamp });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return { branch, data, prev_hash: prevHash, timestamp, hash };
  }

  _sign(hash) {
    return crypto.createHmac('sha256', PROTOCOL_SECRET).update(hash).digest('hex');
  }
}

/**
 * السلطة التشريعية: تُنشئ القوانين المعرفية
 */
class CognitiveLegislature {
  async getActiveLaws(itemId) {
    const laws = [];

    // القانون 1: قانون المصدر الموثوق
    const sourceRep = await this._getSourceReputation(itemId);
    laws.push({
      type: 'SOURCE_TRUST',
      rule: `Source reputation is ${sourceRep}. If < 30, auto-reject.`,
      value: sourceRep,
      enforce: (decision) => sourceRep < 30 ? 'REJECT' : null
    });

    // القانون 2: قانون الإجماع
    const sql = `SELECT metadata->'verification'->>'verdict' as verdict, 
                        metadata->'verification'->>'confidence' as conf
                 FROM intelligence_raw WHERE id = $1`;
    const readIntent = { agentName: 'legislature', userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' };
    const dbResult = await queryData(sql, [itemId], 'intelligence', 'legislature', 'sovereign_system', readIntent);
    
    if (dbResult.success && dbResult.rows.length > 0) {
      const tpav = dbResult.rows[0];
      laws.push({
        type: 'TPAV_CONSENSUS',
        rule: `TPAV verdict is ${tpav.verdict} with confidence ${tpav.conf}. If REJECTED, auto-reject.`,
        value: tpav,
        enforce: (decision) => tpav.verdict !== 'SURVIVED' ? 'REJECT' : null
      });
    }

    // القانون 3: قانون التكرار (إذا ظهر نفس الاتجاه 3+ مرات، ارفع الثقة)
    const trendSql = `SELECT metadata->'strategic_analysis'->>'trend' as trend FROM intelligence_raw WHERE id = $1`;
    const trendResult = await queryData(trendSql, [itemId], 'intelligence', 'legislature', 'sovereign_system', readIntent);
    
    if (trendResult.success && trendResult.rows.length > 0 && trendResult.rows[0].trend) {
      const momentumSql = `SELECT COUNT(*) as count FROM intelligence_raw 
                           WHERE metadata->'strategic_analysis'->>'trend' = $1
                           AND collected_at > NOW() - INTERVAL '24 hours'`;
      const momentumResult = await queryData(momentumSql, [trendResult.rows[0].trend], 'intelligence', 'legislature', 'sovereign_system', readIntent);
      
      if (momentumResult.success && momentumResult.rows.length > 0) {
        const momentum = parseInt(momentumResult.rows[0].count || 0);
        laws.push({
          type: 'TREND_MOMENTUM',
          rule: `Trend appeared ${momentum} times in 24h. If >= 3, boost confidence by 15.`,
          value: momentum,
          enforce: (decision) => null, // لا ترفض، لكن تُعزز
          boost: momentum >= 3 ? 15 : 0
        });
      }
    }

    return laws;
  }

  async _getSourceReputation(itemId) {
    try {
      const sql = `SELECT COALESCE(AVG(reputation_score), 50) as avg_rep 
                   FROM source_reputation 
                   WHERE domain_url IN (
                     SELECT metadata->>'source_domain' 
                     FROM intelligence_raw 
                     WHERE id = $1
                   )`;
      const result = await queryData(sql, [itemId], 'intelligence', 'legislature', 'sovereign_system',
        { agentName: 'legislature', userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' });
      return result.success && result.rows.length > 0 ? Math.min(100, Math.max(0, parseInt(result.rows[0].avg_rep || 50))) : 50;
    } catch (e) {
      return 50;
    }
  }
}

/**
 * السلطة التنفيذية: تنفذ القرار بناءً على القوانين
 */
class CognitiveExecutive {
  async decide(itemId, laws) {
    // 1. فحص القوانين الإلزامية أولاً
    for (const law of laws) {
      if (law.enforce) {
        const enforcement = law.enforce(null);
        if (enforcement === 'REJECT') {
          return {
            success: true,
            decision: 'REJECT',
            reasoning: `Auto-rejected by law: ${law.type}`,
            confidence: 0,
            model: 'cognitive_law'
          };
        }
      }
    }

    // 2. جلب بيانات القرار
    const sql = `SELECT title, raw_content, metadata->'strategic_analysis' as analysis,
                        metadata->'verification' as verification
                 FROM intelligence_raw WHERE id = $1`;
    const readIntent = { agentName: 'executive', userId: 'sovereign_system', action: 'read_data', layer: 'sovereign', origin: 'system' };
    const dbResult = await queryData(sql, [itemId], 'intelligence', 'executive', 'sovereign_system', readIntent);
    
    if (!dbResult.success || dbResult.rows.length === 0) {
      return { success: false, error: 'Item not found.' };
    }

    const item = dbResult.rows[0];

    // 3. اتخاذ القرار عبر LLM (لكن ضمن حدود القوانين)
    const prompt = `You are the Executive Branch of a Cognitive Government.
Analyze this intelligence and decide: PUBLISH, ARCHIVE, or DEFER.
Laws you MUST obey:
 ${laws.map(l => `- ${l.type}: ${l.rule}`).join('\n')}

Intelligence Data:
Title: ${item.title}
Analysis: ${JSON.stringify(item.analysis)}
Verification: ${JSON.stringify(item.verification)}

Return JSON ONLY: {"decision": "PUBLISH|ARCHIVE|DEFER", "reasoning": "...", "confidence": 0-100}`;

    const result = await multiModel.runSingle('sovereign_decision', prompt, 'You are a cognitive executive agent.');
    if (!result.approved) {
      return { success: false, error: 'Executive inference failed.' };
    }

    let decision;
    try {
      let cleaned = result.content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      decision = JSON.parse(match ? match[0] : cleaned);
    } catch (e) {
      return { success: false, error: 'Failed to parse executive decision.' };
    }

    // 4. تطبيق التعزيزات من القوانين
    let finalConfidence = decision.confidence || 50;
    for (const law of laws) {
      if (law.boost) {
        finalConfidence = Math.min(100, finalConfidence + law.boost);
      }
    }

    return {
      success: true,
      decision: decision.decision,
      reasoning: decision.reasoning,
      confidence: finalConfidence,
      model: result.model
    };
  }
}

/**
 * السلطة القضائية: مراجعة دستورية للقرار
 */
class CognitiveJudiciary {
  async review(executiveDecision, laws, itemId) {
    // 1. فحص دستوري: هل خالف التنفيذي أي قانون؟
    const violations = [];

    for (const law of laws) {
      if (law.enforce) {
        const enforcement = law.enforce(executiveDecision);
        if (enforcement && enforcement !== executiveDecision.decision) {
          violations.push({
            law: law.type,
            rule: law.rule,
            expected: enforcement,
            actual: executiveDecision.decision
          });
        }
      }
    }

    // 2. إذا كانت هناك انتهاكات صريحة، إلغاء تلقائي
    if (violations.length > 0) {
      return {
        verdict: 'UNCONSTITUTIONAL',
        violations,
        override: true,
        model: 'cognitive_law'
      };
    }

    // 3. مراجعة قضائية عبر LLM (مراجعة دوافع القرار)
    const prompt = `You are the Judicial Branch of a Cognitive Government.
Review this executive decision for rationality and safety.

Decision: ${executiveDecision.decision}
Reasoning: ${executiveDecision.reasoning}
Confidence: ${executiveDecision.confidence}

Is this decision rational, safe, and aligned with the laws?
Return JSON ONLY: {"verdict": "CONSTITUTIONAL" | "UNCONSTITUTIONAL", "override": true/false, "reason": "..."}`;

    const result = await multiModel.runSingle('judicial_review', prompt, 'You are a cognitive judicial agent.');
    if (!result.approved) {
      // إذا فشلت المراجعة القضائية، نعتبر القرار دستورياً (Fail-Safe)
      return { verdict: 'CONSTITUTIONAL', violations: [], override: false, model: 'fallback' };
    }

    let review;
    try {
      let cleaned = result.content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      review = JSON.parse(match ? match[0] : cleaned);
    } catch (e) {
      return { verdict: 'CONSTITUTIONAL', violations: [], override: false, model: 'fallback' };
    }

    return {
      verdict: review.verdict || 'CONSTITUTIONAL',
      violations: review.verdict === 'UNCONSTITUTIONAL' ? [{ law: 'JUDICIAL_REVIEW', rule: review.reason }] : [],
      override: review.override || false,
      model: result.model
    };
  }
}

export const cognitiveGovernment = new CognitiveGovernment();
export default cognitiveGovernment;
