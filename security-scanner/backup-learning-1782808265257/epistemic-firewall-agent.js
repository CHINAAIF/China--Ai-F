import { logExecution, safeStep } from '../utils/executor.js';
import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import crypto from 'crypto';
import { safeGroqJSON } from '../utils/safe-json.js';
import { pingHeartbeat } from '../utils/heartbeat.js';

class EpistemicFirewallAgent {
  constructor() {
    this.name = 'epistemic_firewall_agent';
    this.layer = 'learning';
    this.status = 'active';
  }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status='db_error'; return false; }
  }

  async promoteToFiltered(item, verdict) {
    try {
      const hash = crypto.createHash('sha256')
        .update(item.content_hash+':filtered')
        .digest('hex').slice(0,64);
      await pool.query(`
        INSERT INTO brain_filtered_memory
        (content_hash,topic,domain,content,confidence,source_count,usage_count,last_used,expires_at,decay_rate)
        VALUES ($1,$2,$3,$4,$5,1,0,now(),now()+interval'30 days',3)
        ON CONFLICT (content_hash) DO NOTHING`,
        [hash, item.topic, item.domain,
         typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
         Math.min(100,Math.max(0,Math.round(verdict.promoted_confidence||item.confidence||60)))]
      );
      // تحديث working_memory — رُفع للـfiltered
      await pool.query(`
        UPDATE brain_working_memory SET quarantine=false, verified_by=array_append(verified_by,$1)
        WHERE id=$2`,
        [this.name, item.id]
      );
      return { promoted: true, hash };
    } catch(e) {
      console.warn(`⚠️ promote_fail: ${e.message}`);
      return { promoted: false, error: e.message };
    }
  }

  async rejectFromWorking(itemId, reason) {
    try {
      await pool.query(`
        DELETE FROM brain_working_memory WHERE id=$1`,
        [itemId]
      );
      return { rejected: true, reason };
    } catch(e) {
      console.warn(`⚠️ reject_fail: ${e.message}`);
      return { rejected: false };
    }
  }

  async run(input = {}) {
    try {
      await pingHeartbeat(this.name, 'active', { layer: this.layer });

      // 1. جلب العناصر التي انتهت quarantine_until فقط
      const items = await pool.query(`
        SELECT id,content_hash,topic,domain,content,confidence,source_reputation,verified_by
        FROM brain_working_memory
        WHERE quarantine=true AND quarantine_until < now()
        ORDER BY confidence DESC, source_reputation DESC
        LIMIT 10`);

      if(!items.rows.length) {
        return { success:true, message:'no_items_ready', promoted:0, rejected:0 };
      }

      let promoted=0, rejected=0;
      const results=[];

      for(const item of items.rows) {
        try {
          const contentStr = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
          
          // 2. تقييم epistemically بـGroq
          const verdict = await safeGroqJSON(
            `أنت وكيل الجدار الناري المعرفي. قيّم هذه المعرفة المقترحة للترقية من الحجر الصحي إلى الذاكرة المصفّاة.` +
            `الموضوع: ${item.topic} | المجال: ${item.domain}` +
            `المحتوى: ${contentStr.slice(0,500)}` +
            `الثقة الحالية: ${item.confidence} | سمعة المصدر: ${item.source_reputation}` +
            `قيّم: هل هذه المعرفة دقيقة وموثوقة وتستحق الترقية؟` +
            `أجب بـ JSON: {promote:boolean,promoted_confidence:number,rejection_reason:string,epistemic_quality:string,risks:array}`,
            null, this.name
          );

          if(!verdict.data) {
            results.push({ topic:item.topic, status:'verdict_failed', error:verdict.error });
            continue;
          }

          if(verdict.data.promote && (item.confidence>=50) && (item.source_reputation>=30)) {
            const p = await this.promoteToFiltered(item, verdict.data);
            if(p.promoted) { promoted++; results.push({ topic:item.topic, status:'promoted', confidence:verdict.data.promoted_confidence }); }
          } else {
            const r = await this.rejectFromWorking(item.id, verdict.data.rejection_reason||'low_quality');
            if(r.rejected) { rejected++; results.push({ topic:item.topic, status:'rejected', reason:verdict.data.rejection_reason }); }
          }
        } catch(e) {
          console.warn(`⚠️ item_process ${item.topic}: ${e.message}`);
          results.push({ topic:item.topic, status:'error', error:e.message });
        }
      }

      // 3. تسجيل
      try {
        await pool.query(`
          INSERT INTO agent_execution_logs (agent_name,action,input,output,confidence,status)
          VALUES ($1,'filter',$2,$3,$4,'completed')`,
          [this.name, JSON.stringify({items_processed:items.rows.length}),
           JSON.stringify({promoted,rejected,results}),
           Math.min(100,Math.max(0,promoted>0?85:50))]
        );
      } catch(e) { console.warn(`⚠️ log_fail: ${e.message}`); }

      // 4. تحقق فعلي
      const verify = await pool.query(`SELECT COUNT(*) FROM brain_filtered_memory`);
      console.log(`✅ epistemic_firewall: promoted=${promoted} rejected=${rejected} filtered_total=${verify.rows[0].count}`);

      return { success:true, promoted, rejected, results, filtered_total:parseInt(verify.rows[0].count) };

    } catch(e) {
      console.error(`❌ epistemic_firewall_agent: ${e.message}`);
      return { success:false, error:e.message };
    }
  }

  async runDiagnostic() {
    const r = await this.run({test:true});
    return { agent:this.name, status:r.success?'ok':'error', ...r };
  }
}

export const epistemicFirewallAgent = new EpistemicFirewallAgent();
export default epistemicFirewallAgent;
