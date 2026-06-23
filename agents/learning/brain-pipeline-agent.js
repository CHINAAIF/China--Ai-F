/**
 * brain-pipeline-agent | layer: learning
 * العقليات: 17(Self-Evolution) + 18(Anomaly) + 20(Anti-Fragility)
 * يرفع الحجر المنتهي → يُقيّم confidence → ينقل المؤهل → يُسجّل gaps
 */
import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import { safeGroqJSON } from '../utils/safe-json.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

class BrainPipelineAgent {
  constructor() { this.name='brain-pipeline-agent'; this.layer='learning'; this.status='active'; }

  async initialize() {
    try { await pool.query('SELECT 1'); return true; }
    catch(e) { this.status='db_error'; return false; }
  }

  async run(input) {
    input = input || {};
    const stats = { released:0, scored:0, filtered:0, gaps:0 };

    // 1. ارفع الحجر المنتهي
    try {
      const r = await pool.query(`UPDATE brain_working_memory SET quarantine=false, quarantine_until=NULL WHERE quarantine=true AND quarantine_until < NOW() RETURNING id`);
      stats.released = r.rows.length;
    } catch(e) { console.error('❌ LIFT (متابعة):', e.message); }

    // 2. قيّم confidence للسجلات المنخفضة
    try {
      const low = await pool.query(`SELECT id, topic, domain, content FROM brain_working_memory WHERE quarantine=false AND confidence < 60`);
      for(const rec of low.rows) {
        try {
          const result = await safeGroqJSON(`Rate AI signal quality 0-100. Topic:${rec.topic} Domain:${rec.domain}. JSON: {"confidence":75,"quality":"medium"}`);
          const conf = Math.min(100, Math.max(0, Math.round(Number(result.data?.confidence)||60)));
          await pool.query(`UPDATE brain_working_memory SET confidence=$1 WHERE id=$2`,[conf,rec.id]);
          stats.scored++;
        } catch(e) { console.warn('⚠️ SCORE (متابعة):', e.message); }
      }
    } catch(e) { console.error('❌ SCORE (متابعة):', e.message); }

    // 3. انقل المؤهلين
    try {
      const eligible = await pool.query(`SELECT * FROM brain_working_memory WHERE quarantine=false AND confidence >= 60`);
      for(const rec of eligible.rows) {
        try {
          const exists = await pool.query(`SELECT id FROM brain_filtered_memory WHERE content_hash=$1`,[rec.content_hash]);
          if(exists.rows.length) continue;
          await pool.query(
            `INSERT INTO brain_filtered_memory (content_hash,topic,domain,content,confidence,source_count,usage_count,decay_rate,created_at) VALUES ($1,$2,$3,$4,$5,1,0,5,NOW())`,
            [rec.content_hash,rec.topic,rec.domain,JSON.stringify(rec.content),rec.confidence]
          );
          stats.filtered++;
        } catch(e) { console.warn('⚠️ FILTER (متابعة):', e.message); }
      }
    } catch(e) { console.error('❌ FILTER (متابعة):', e.message); }

    // 4. سجّل gaps للمنخفضين
    try {
      const low2 = await pool.query(`SELECT topic,domain FROM brain_working_memory WHERE confidence < 60 AND quarantine=false`);
      for(const rec of low2.rows) {
        try {
          await pool.query(`INSERT INTO brain_knowledge_gaps (topic,domain,priority,search_count,filled,created_at) VALUES ($1,$2,7,0,false,NOW()) ON CONFLICT DO NOTHING`,[rec.topic||'unknown',rec.domain||'general']);
          stats.gaps++;
        } catch(e) { console.warn('⚠️ GAP (متابعة):', e.message); }
      }
    } catch(e) { console.error('❌ GAPS (متابعة):', e.message); }

    return { success:true, data: stats };
  }

  async runDiagnostic() {
    const r = await this.run({});
    return { agent:this.name, layer:this.layer, status:r.success?'ok':'error', ...r };
  }
}

export const brainPipelineAgent = new BrainPipelineAgent();
export default brainPipelineAgent;
