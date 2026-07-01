import { logExecution, safeStep } from '../utils/executor.js';
import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { pingHeartbeat } from '../utils/heartbeat.js';

const HMAC_SECRET = process.env.ENCRYPTION_KEY || 'chinaaif-sovereign-secret';

class MemoryPromotionEngine {
  constructor() {
    this.name = 'memory_promotion_engine';
    this.layer = 'learning';
    this.status = 'active';
    // عتبات الترقية — مبنية على schema الفعلي
    this.FILTERED_TO_HARD_THRESHOLD   = { confidence: 75, source_count: 2, usage_count: 1 };
    this.HARD_TO_SOVEREIGN_THRESHOLD  = { confidence: 90, verification_count: 3, source_diversity: 2 };
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status='db_error'; return false; }
  }

  contentHash(input) {
    return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0,64);
  }

  sovereignHMAC(hash, decisionText) {
    return crypto.createHmac('sha256', HMAC_SECRET)
      .update(`${hash}:${decisionText}`)
      .digest('hex');
  }

  // ── الترقية الأولى: filtered → hard ─────────────────────────────
  async promoteFilteredToHard(item) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // استدعاء Groq لتحويل content jsonb → rule_text نصي صريح (مطلوب NOT NULL في hard)
      const synthesis = await safeGroqJSON(
        `أنت محرك ترقية الذاكرة. حوّل هذه المعرفة المصفّاة إلى قاعدة صلبة قابلة للتطبيق. ` +
        `الموضوع: ${item.topic} | المجال: ${item.domain} | ` +
        `المحتوى: ${JSON.stringify(item.content).slice(0,600)} | ` +
        `الثقة: ${item.confidence} | عدد المصادر: ${item.source_count}. ` +
        `أجب بـ JSON: {rule_text:string,confidence:number,is_global:boolean,source_diversity:number}`,
        null, this.name
      );

      if(!synthesis.data || !synthesis.data.rule_text) {
        await client.query('ROLLBACK');
        return { promoted: false, reason: 'synthesis_failed' };
      }

      const hash = this.contentHash({ topic: item.topic, domain: item.domain, rule: synthesis.data.rule_text });

      // INSERT في brain_hard_memory — كل الأعمدة NOT NULL مُعالجة
      await client.query(`
        INSERT INTO brain_hard_memory
        (content_hash, rule_text, domain, confidence, verification_count, source_diversity, applied_count, last_validated, is_global)
        VALUES ($1,$2,$3,$4,$5,$6,0,now(),$7)
        ON CONFLICT (content_hash) DO UPDATE SET
          verification_count = brain_hard_memory.verification_count + 1,
          last_validated = now(),
          confidence = GREATEST(brain_hard_memory.confidence, EXCLUDED.confidence)`,
        [
          hash,
          synthesis.data.rule_text,
          item.domain,
          Math.min(100, Math.max(0, Math.round(synthesis.data.confidence || item.confidence))),
          1,
          Math.min(10, Math.max(1, Math.round(synthesis.data.source_diversity || item.source_count || 1))),
          synthesis.data.is_global || false
        ]
      );

      // تحديث usage_count في filtered
      await client.query(`UPDATE brain_filtered_memory SET usage_count=usage_count+1, last_used=now() WHERE id=$1`, [item.id]);

      await client.query('COMMIT');
      return { promoted: true, hash, rule_text: synthesis.data.rule_text.slice(0,80) };
    } catch(e) {
      await client.query('ROLLBACK');
      console.warn(`⚠️ filtered→hard fail: ${e.message}`);
      return { promoted: false, reason: e.message };
    } finally { client.release(); }
  }

  // ── الترقية الثانية: hard → sovereign ───────────────────────────
  async promoteHardToSovereign(item) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Groq يُنتج decision_text + consensus_models
      const decision = await safeGroqJSON(
        `أنت محرك الترقية السيادية. هذه القاعدة الصلبة مرشحة للذاكرة السيادية غير القابلة للتغيير. ` +
        `القاعدة: ${item.rule_text} | المجال: ${item.domain} | ` +
        `الثقة: ${item.confidence} | التحقق: ${item.verification_count} مرة | التنوع: ${item.source_diversity}. ` +
        `قيّم وأنتج: هل تستحق الخلود السيادي؟ ` +
        `أجب بـ JSON: {decision_text:string,confidence:number,consensus_models:array,ground_truth_verified:boolean,promote:boolean}`,
        null, this.name
      );

      if(!decision.data || !decision.data.promote || !decision.data.decision_text) {
        await client.query('ROLLBACK');
        return { promoted: false, reason: decision.data?.promote === false ? 'not_worthy' : 'decision_failed' };
      }

      const hash = this.contentHash({ domain: item.domain, decision: decision.data.decision_text });
      const hmac = this.sovereignHMAC(hash, decision.data.decision_text);

      // INSERT في brain_sovereign_memory — immutable=true دائماً
      await client.query(`
        INSERT INTO brain_sovereign_memory
        (content_hash, decision_text, domain, confidence, consensus_models, ground_truth_verified, hmac_signature, immutable)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true)
        ON CONFLICT (content_hash) DO NOTHING`,
        [
          hash,
          decision.data.decision_text,
          item.domain,
          Math.min(100, Math.max(0, Math.round(decision.data.confidence || item.confidence))),
          decision.data.consensus_models || [this.name],
          decision.data.ground_truth_verified || false,
          hmac
        ]
      );

      // تحديث applied_count في hard
      await client.query(`UPDATE brain_hard_memory SET applied_count=applied_count+1, last_validated=now() WHERE id=$1`, [item.id]);

      await client.query('COMMIT');
      return { promoted: true, hash, hmac_prefix: hmac.slice(0,16) };
    } catch(e) {
      await client.query('ROLLBACK');
      console.warn(`⚠️ hard→sovereign fail: ${e.message}`);
      return { promoted: false, reason: e.message };
    } finally { client.release(); }
  }

  // ── كشف التعارضات وتسجيلها ──────────────────────────────────────
  async detectConflicts(newHash, domain, existingTable) {
    try {
      const existing = await pool.query(`SELECT content_hash FROM ${existingTable} WHERE domain=$1 LIMIT 5`, [domain]);
      for(const row of existing.rows) {
        if(row.content_hash !== newHash) {
          await pool.query(`
            INSERT INTO knowledge_conflicts (existing_hash, challenger_hash, domain, conflict_type, resolution)
            VALUES ($1,$2,$3,'domain_overlap','pending')
            ON CONFLICT DO NOTHING`,
            [row.content_hash, newHash, domain]
          ).catch(()=>{});
        }
      }
    } catch(e) { console.warn(`⚠️ conflict_detect: ${e.message}`); }
  }

  async run(input = {}) {
    try {
      await pingHeartbeat(this.name, 'active', { layer: this.layer });

      let f2h_promoted=0, h2s_promoted=0, f2h_skipped=0, h2s_skipped=0;
      const results = [];

      // ── المرحلة 1: filtered → hard ──────────────────────────────
      const filteredItems = await pool.query(`
        SELECT id, content_hash, topic, domain, content, confidence, source_count, usage_count
        FROM brain_filtered_memory
        WHERE confidence >= $1 AND source_count >= $2 AND usage_count >= $3
        ORDER BY confidence DESC, source_count DESC
        LIMIT 5`,
        [this.FILTERED_TO_HARD_THRESHOLD.confidence,
         this.FILTERED_TO_HARD_THRESHOLD.source_count,
         this.FILTERED_TO_HARD_THRESHOLD.usage_count]
      );

      for(const item of filteredItems.rows) {
        try {
          await this.detectConflicts(item.content_hash, item.domain, 'brain_hard_memory');
          const r = await this.promoteFilteredToHard(item);
          if(r.promoted) { f2h_promoted++; results.push({ from:'filtered', to:'hard', topic:item.topic, status:'promoted', rule:r.rule_text }); }
          else { f2h_skipped++; results.push({ from:'filtered', to:'hard', topic:item.topic, status:'skipped', reason:r.reason }); }
        } catch(e) { f2h_skipped++; console.warn(`⚠️ f2h ${item.topic}: ${e.message}`); }
      }

      // ── المرحلة 2: hard → sovereign ─────────────────────────────
      const hardItems = await pool.query(`
        SELECT id, content_hash, rule_text, domain, confidence, verification_count, source_diversity
        FROM brain_hard_memory
        WHERE confidence >= $1 AND verification_count >= $2 AND source_diversity >= $3
        ORDER BY confidence DESC, verification_count DESC
        LIMIT 3`,
        [this.HARD_TO_SOVEREIGN_THRESHOLD.confidence,
         this.HARD_TO_SOVEREIGN_THRESHOLD.verification_count,
         this.HARD_TO_SOVEREIGN_THRESHOLD.source_diversity]
      );

      for(const item of hardItems.rows) {
        try {
          await this.detectConflicts(item.content_hash, item.domain, 'brain_sovereign_memory');
          const r = await this.promoteHardToSovereign(item);
          if(r.promoted) { h2s_promoted++; results.push({ from:'hard', to:'sovereign', domain:item.domain, status:'promoted', hmac:r.hmac_prefix }); }
          else { h2s_skipped++; results.push({ from:'hard', to:'sovereign', domain:item.domain, status:'skipped', reason:r.reason }); }
        } catch(e) { h2s_skipped++; console.warn(`⚠️ h2s ${item.domain}: ${e.message}`); }
      }

      // ── تسجيل في execution_logs ──────────────────────────────────
      try {
        await pool.query(`
          INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status)
          VALUES ($1,'promote',$2,$3,$4,'completed')`,
          [this.name,
           JSON.stringify({ filtered_candidates: filteredItems.rows.length, hard_candidates: hardItems.rows.length }),
           JSON.stringify({ f2h_promoted, h2s_promoted, f2h_skipped, h2s_skipped, results }),
           Math.min(100, Math.max(0, (f2h_promoted+h2s_promoted)>0 ? 85 : 50))]
        );
      } catch(e) { console.warn(`⚠️ log_fail: ${e.message}`); }

      // ── تحقق فعلي ────────────────────────────────────────────────
      const [hard_cnt, sovereign_cnt] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM brain_hard_memory`),
        pool.query(`SELECT COUNT(*) FROM brain_sovereign_memory`)
      ]);
      console.log(`✅ memory_promotion: f2h=${f2h_promoted} h2s=${h2s_promoted} hard_total=${hard_cnt.rows[0].count} sovereign_total=${sovereign_cnt.rows[0].count}`);

      return { success:true, f2h_promoted, h2s_promoted, f2h_skipped, h2s_skipped, results,
               hard_total: parseInt(hard_cnt.rows[0].count), sovereign_total: parseInt(sovereign_cnt.rows[0].count) };

    } catch(e) {
      console.error(`❌ memory_promotion_engine: ${e.message}`);
      return { success:false, error:e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({ test:true });
    return { agent:this.name, status:r.success?'ok':'error', ...r };
  }
}

export const memoryPromotionEngine = new MemoryPromotionEngine();
export default memoryPromotionEngine;
