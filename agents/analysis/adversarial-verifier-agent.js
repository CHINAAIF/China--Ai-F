/**
 * TRUNKIA Adversarial Verifier Agent (TPAV)
 * Tri-Phase Adversarial Verification with Cryptographic Chain.
 */
import { BaseAgent } from '../base-agent.js';
import { queryData, mutateData } from '../../lib/tools/sql-tool.js';
import { readMemory, writeMemory } from '../../lib/blackboard.js';
import crypto from 'crypto';

const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-secret';

class AdversarialVerifierAgent extends BaseAgent {
  constructor() {
    super('adversarial_verifier', 'analysis');
  }

  async run() {
    try {
      // 1. الاستيقاظ: هل هناك تحليل استراتيجي جديد؟
      const trendSignal = await readMemory('analysis:new_strategic_trend');
      if (!trendSignal) {
        return { success: true, message: 'No new trends to verify. Verifier resting.' };
      }

      // 2. جلب التحليلات غير المتحقق منها (System Origin, Read-Only)
      const sql = `SELECT id, title, raw_content, metadata->'strategic_analysis' as analysis 
                   FROM intelligence_raw 
                   WHERE is_verified = true 
                   AND metadata->'strategic_analysis' IS NOT NULL
                   AND metadata->'verification' IS NULL
                   ORDER BY collected_at DESC LIMIT 3`;
      
      const readIntent = { agentName: this.name, userId: 'sovereign_system', action: 'read_data', layer: 'analysis', origin: 'system' };
      const dbResult = await queryData(sql, [], 'intelligence', this.name, 'sovereign_system', readIntent);
      
      if (!dbResult.success || dbResult.rows.length === 0) {
        return { success: true, message: 'No unverified strategic analyses found.' };
      }

      let verified = 0;
      let rejected = 0;

      for (const item of dbResult.rows) {
        const analysis = item.analysis;
        if (!analysis) continue;

        const chain = [];

        // === الطور 1: هجوم المضاد (Counter-Thesis Attack) ===
        const counterPrompt = `You are an adversarial AI auditor. The following strategic analysis was made about AI intelligence:
Analysis: "${JSON.stringify(analysis)}"
Raw Data: "${(item.raw_content || '').substring(0, 200)}"

Generate the STRONGEST possible COUNTER-ARGUMENT against this analysis using the same raw data. 
Return JSON ONLY: {"counter_thesis": "...", "counter_strength": 1-10, "flaws_found": ["flaw1", "flaw2"]}`;

        const counterResult = await this.think(counterPrompt, 'You are a critical AI auditor seeking flaws.');
        if (counterResult.error || !counterResult.data) continue;

        const block1 = this._createBlock('COUNTER_ATTACK', {
          counter_thesis: counterResult.data.counter_thesis?.substring(0, 100),
          counter_strength: counterResult.data.counter_strength,
          flaws_found: counterResult.data.flaws_found?.length || 0
        }, null);
        chain.push(block1);

        // === الطور 2: تدقيق الأدلة (Evidence Audit) ===
        const auditPrompt = `You are an evidence auditor. Check if this analysis is factually grounded in the raw data.
Analysis: "${JSON.stringify(analysis)}"
Raw Data: "${(item.raw_content || '').substring(0, 300)}"

Find any claims in the analysis that are NOT supported by the raw data.
Return JSON ONLY: {"unsupported_claims": ["..."], "fabrication_detected": true/false, "audit_score": 1-10}`;

        const auditResult = await this.think(auditPrompt, 'You are a strict evidence auditor.');
        if (auditResult.error || !auditResult.data) continue;

        const block2 = this._createBlock('EVIDENCE_AUDIT', {
          unsupported_claims: auditResult.data.unsupported_claims?.length || 0,
          fabrication_detected: auditResult.data.fabrication_detected || false,
          audit_score: auditResult.data.audit_score
        }, block1.hash);
        chain.push(block2);

        // === الطور 3: الحكم النهائي (Final Verdict) ===
        const verdictPrompt = `You are a final arbiter. Review all evidence:
Original Analysis: "${JSON.stringify(analysis)}"
Counter-Argument: "${JSON.stringify(counterResult.data)}"
Evidence Audit: "${JSON.stringify(auditResult.data)}"

Does the original analysis SURVIVE the adversarial challenge? Is it factually grounded?
Return JSON ONLY: {"verdict": "SURVIVED" | "REJECTED", "confidence": 0-100, "reason": "..."}`;

        const verdictResult = await this.think(verdictPrompt, 'You are a final AI arbiter.');
        if (verdictResult.error || !verdictResult.data) continue;

        const verdict = verdictResult.data;

        const block3 = this._createBlock('FINAL_VERDICT', {
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          reason: verdict.reason?.substring(0, 100)
        }, block2.hash);
        block3.signature = this._sign(block3.hash);
        chain.push(block3);

        // === الكتابة السيادية: تحديث الـ DB بالتحقق العدائي ===
        const verificationRecord = {
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          counter_thesis: counterResult.data.counter_thesis,
          flaws_found: counterResult.data.flaws_found || [],
          fabrication_detected: auditResult.data.fabrication_detected || false,
          chain: chain,
          verified_at: Date.now(),
          verifier_model: verdictResult.model
        };

        const updateSql = `UPDATE intelligence_raw SET metadata = jsonb_set(metadata, '{verification}', $1::jsonb) WHERE id = $2`;
        const updateParams = [JSON.stringify(verificationRecord), item.id];
        const writeIntent = { agentName: this.name, userId: 'sovereign_system', action: 'execute_sql_write', layer: 'analysis', origin: 'system', table: 'intelligence_raw' };
        
        const writeResult = await mutateData(updateSql, updateParams, 'intelligence', this.name, 'sovereign_system', writeIntent);
        if (!writeResult.success) continue;

        if (verdict.verdict === 'SURVIVED') {
          verified++;
        } else {
          rejected++;
        }
      }

      // === البث المعرفي: إيقاظ طبقة القرار ===
      if (verified + rejected > 0) {
        await writeMemory('analysis:verification_complete', {
          verified, rejected, timestamp: Date.now()
        }, 3600);
      }

      return { success: true, verified, rejected };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error.message);
      return { success: false, error: error.message };
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

export const adversarialVerifierAgent = new AdversarialVerifierAgent();
export default adversarialVerifierAgent;
