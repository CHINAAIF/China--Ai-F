import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { pingHeartbeat } from '../utils/heartbeat.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class BrainAcquisitionAgent {
  constructor() {
    this.name = 'brain_acquisition_agent';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status = 'db_error'; return false; }
  }

  contentHash(topic, domain, content) {
    return crypto.createHash('sha256')
      .update(`${topic}:${domain}:${JSON.stringify(content)}`)
      .digest('hex').slice(0, 64);
  }

  async getSourceReputation(sourceUrl) {
    try {
      if(!sourceUrl) return 50;
      const domain = new URL(sourceUrl).hostname.replace('www.','');
      const r = await pool.query(
        `SELECT reputation_score, blacklisted FROM source_reputation WHERE domain_url=$1`,
        [domain]
      );
      if(r.rows.length && r.rows[0].blacklisted) return 0;
      return r.rows.length ? r.rows[0].reputation_score : 50;
    } catch(e) { return 50; }
  }

  async insertToWorkingMemory(topic, domain, content, sourceUrl, confidence, sourceReputation) {
    const hash = this.contentHash(topic, domain, content);
    const quarantineUntil = new Date(Date.now() + 48*60*60*1000);
    try {
      await pool.query(
        `INSERT INTO brain_working_memory
         (content_hash, topic, domain, content, source_url, source_reputation, confidence, quarantine, quarantine_until, verified_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
         ON CONFLICT (content_hash) DO NOTHING`,
        [
          hash, topic, domain,
          JSON.stringify(typeof content === 'object' ? content : {raw: content}),
          sourceUrl||null,
          Math.min(100, Math.max(0, Math.round(sourceReputation||50))),
          Math.min(100, Math.max(0, Math.round(confidence||50))),
          quarantineUntil,
          []
        ]
      );
      return { inserted: true, hash };
    } catch(e) {
      console.warn(`⚠️ insert_working_memory: ${e.message}`);
      return { inserted: false, error: e.message };
    }
  }

  async markGapSearched(gapId) {
    try {
      await pool.query(
        `UPDATE brain_knowledge_gaps SET last_searched=now(), search_count=search_count+1 WHERE id=$1`,
        [gapId]
      );
    } catch(e) { console.warn(`⚠️ mark_gap: ${e.message}`); }
  }

  async markGapFilled(gapId) {
    try {
      await pool.query(
        `UPDATE brain_knowledge_gaps SET filled=true, last_searched=now() WHERE id=$1`,
        [gapId]
      );
    } catch(e) { console.warn(`⚠️ fill_gap: ${e.message}`); }
  }

  async run(input = {}) {
    try {
      await pingHeartbeat(this.name, 'active', { layer: this.layer });

      // 1. جلب أعلى الثغرات المعرفية أولوية غير المملوءة
      const gaps = await pool.query(
        `SELECT id, topic, domain, priority, search_count
         FROM brain_knowledge_gaps
         WHERE filled=false
         ORDER BY priority DESC, search_count ASC
         LIMIT 3`
      );

      if(!gaps.rows.length) {
        return { success: true, message: 'no_gaps_pending', inserted: 0 };
      }

      let totalInserted = 0;
      const results = [];

      for(const gap of gaps.rows) {
        try {
          await this.markGapSearched(gap.id);

          // 2. استدعاء Groq لاكتساب معرفة عن الثغرة
          const acquired = await safeGroqJSON(
        `أنت وكيل اكتساب معرفة متخصص في الذكاء الاصطناعي الصيني والعالمي. ` +
            `ابحث في معرفتك عن: الموضوع "${gap.topic}" في مجال "${gap.domain}". ` +
            `قدّم معلومات دقيقة وموثوقة. ` +
            `أجب بـ JSON: {` +
            `findings:[{title:string,summary:string,key_facts:array,confidence:number,source_type:string}],` +
            `overall_confidence:number,` +
            `knowledge_quality:string,` +
            `recommended_sources:array` +
            `}`,
        null,
        this.name
      );

          if(!acquired.data || !acquired.data.findings?.length) {
            results.push({ gap: gap.topic, status: 'no_findings' });
            continue;
          }

          // 3. حقن كل finding في brain_working_memory تحت Quarantine 48h
          for(const finding of acquired.data.findings) {
            try {
              const repScore = 50; // Groq internal knowledge — reputation متوسطة
              const ins = await this.insertToWorkingMemory(
                gap.topic,
                gap.domain,
                {
                  title: finding.title,
                  summary: finding.summary,
                  key_facts: finding.key_facts || [],
                  source_type: finding.source_type || 'ai_knowledge'
                },
                null,
                Math.min(100, Math.max(0, Math.round(finding.confidence || acquired.data.overall_confidence || 50))),
                repScore
              );
              if(ins.inserted) totalInserted++;
            } catch(e) { console.warn(`⚠️ finding_insert: ${e.message}`); }
          }

          // 4. تحديث حالة الثغرة إذا اكتسبنا معرفة كافية
          if(acquired.data.overall_confidence >= 70 && acquired.data.findings.length >= 2) {
            await this.markGapFilled(gap.id);
          }

          results.push({
            gap: gap.topic,
            domain: gap.domain,
            findings: acquired.data.findings.length,
            confidence: acquired.data.overall_confidence,
            status: 'acquired'
          });

        } catch(e) {
          console.warn(`⚠️ gap_process ${gap.topic}: ${e.message}`);
          results.push({ gap: gap.topic, status: 'error', error: e.message });
        }
      }

      // 5. تسجيل في execution logs
      try {
        await pool.query(
          `INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status)
           VALUES ($1,'acquire',$2,$3,$4,'completed')`,
          [
            this.name,
            JSON.stringify({ gaps_processed: gaps.rows.length }),
            JSON.stringify({ results, total_inserted: totalInserted }),
            Math.min(100, Math.max(0, totalInserted > 0 ? 80 : 40))
          ]
        );
      } catch(e) { console.warn(`⚠️ log_fail: ${e.message}`); }

      // 6. تحقق فعلي
      const verify = await pool.query(`SELECT COUNT(*) FROM brain_working_memory WHERE quarantine=true`);
      console.log(`✅ brain_acquisition: inserted=${totalInserted} quarantine_total=${verify.rows[0].count}`);

      return { success: true, inserted: totalInserted, results, quarantine_total: parseInt(verify.rows[0].count) };

    } catch(e) {
      console.error(`❌ brain_acquisition_agent: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({ test: true });
    return { agent: this.name, status: r.success ? 'ok' : 'error', ...r };
  }
}

export const brainAcquisitionAgent = new BrainAcquisitionAgent();
export default brainAcquisitionAgent;
