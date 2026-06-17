import pg from 'pg';
import dotenv from 'dotenv';
import { multiModel } from '../governance/multi-model.js';
import { governor } from '../governance/governor.js';
import { brain } from '../brain.js';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

export class ChinaSocialAgent {
  constructor() {
    this.name = 'china_social_agent';
    this.layer = 'intelligence';
    this.sources = [
      { name: 'Zhihu AI Topics', url: 'https://www.zhihu.com/topic/19554298', type: 'social_media', lang: 'zh' },
      { name: 'Weibo AI', url: 'https://weibo.com/search?q=AI大模型', type: 'social_media', lang: 'zh' },
      { name: 'WeChat AI', url: 'https://feeds.feedburner.com/zhihu-daily', type: 'social_media', lang: 'zh' }
    ];
  }

  async registerSources() {
    for (const src of this.sources) {
      await pool.query(
        `INSERT INTO intelligence_sources 
         (source_name, source_type, source_url, language, is_chinese_source, reliability_score)
         VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT DO NOTHING`,
        [src.name, src.type, src.url, src.lang, 70]
      );
    }
    return { registered: this.sources.length };
  }

  async analyzeChineseContent(content) {
    const prompt = `Analyze this Chinese AI content and respond with ONLY a JSON object, no markdown:
{"is_relevant":true,"signal_type":"pricing","confidence":85,"entities":[],"impact_level":"high"}

Content: ${content.slice(0, 500)}`;

    const response = await multiModel.runGroq(
      prompt,
      'Respond only with a valid JSON object. No markdown. No explanation.'
    );

    try {
      const cleaned = response?.content?.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { is_relevant: false, confidence: 0 };
    }
  }

  async processSignal(content, sourceId, url = null) {
    const analysis = await this.analyzeChineseContent(content);

    if (!analysis.is_relevant || analysis.confidence < 40) {
      return { skipped: true, reason: 'low_relevance' };
    }

    const { rows } = await pool.query(
      `INSERT INTO intelligence_raw 
       (source_id, agent_name, content_type, raw_content, url, language, signals, confidence)
       VALUES ($1,$2,'social_signal',$3,$4,'zh',$5,$6)
       RETURNING id`,
      [sourceId, this.name, content.slice(0, 2000), url, JSON.stringify(analysis), analysis.confidence]
    );

    const rawId = rows[0].id;
    const passed = analysis.confidence >= 60;

    const { rows: candidateRows } = await pool.query(
      `INSERT INTO learning_candidates 
       (source_agent, data_type, raw_data, filter_score, filter_status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [
        this.name,
        analysis.signal_type || 'market_signal',
        JSON.stringify({ rawId, analysis, content: content.slice(0, 500) }),
        analysis.confidence,
        passed ? 'approved' : 'rejected'
      ]
    );

    if (passed) {
      const { approvedId } = await governor.approveLearning(
        candidateRows[0].id,
        [this.name],
        analysis.confidence,
        analysis
      );
      await brain.learn(approvedId);
      await pool.query(
        `UPDATE intelligence_raw SET filter_status='passed' WHERE id=$1`,
        [rawId]
      );
    }

    await pool.query(
      `INSERT INTO agent_execution_logs 
       (agent_name, action, input, output, confidence, status)
       VALUES ($1,'process_signal',$2,$3,$4,$5)`,
      [
        this.name,
        JSON.stringify({ content: content.slice(0, 100) }),
        JSON.stringify(analysis),
        analysis.confidence,
        passed ? 'completed' : 'filtered'
      ]
    );

    return { rawId, passed, confidence: analysis.confidence, signal: analysis.signal_type, impact: analysis.impact_level };
  }

  async run() {
    console.log(`🔍 ${this.name} starting...`);
    await this.registerSources();

    const testSignal = `DeepSeek发布了新版本V3-Ultra，据悉性能超越GPT-4o，价格仅为0.001元/千token，比OpenAI便宜95%。多位AI研究员在知乎确认了这一消息。`;

    const { rows: sources } = await pool.query(
      `SELECT id FROM intelligence_sources WHERE source_name ILIKE '%Zhihu%' LIMIT 1`
    );

    if (!sources[0]) {
      console.log('⚠️ No source found');
      return;
    }

    const result = await this.processSignal(testSignal, sources[0].id);
    console.log(`✅ Signal processed:`, result);
    return result;
  }
}

export const chinaSocialAgent = new ChinaSocialAgent();
export default chinaSocialAgent;
