import dotenv from 'dotenv'; dotenv.config();
import { pool } from './db-intelligence.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function runStandalone() {
  console.log('📰 China News Agent Starting...');
  await pool.query(`UPDATE agent_registry SET status='running', last_run=NOW() WHERE agent_name='china_news_agent'`).catch(() => {});
  await pool.query(`UPDATE agent_heartbeat SET status='alive', last_ping=NOW() WHERE agent_name='china_news_agent'`).catch(() => {});

  const topics = [
    'Chinese AI models 2025',
    'DeepSeek latest news',
    'Alibaba Qwen updates',
    'Baidu ERNIE AI',
    'China AI regulation policy'
  ];

  let totalProcessed = 0;
  for (const topic of topics) {
    try {
      const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Search and summarize latest news about: ${topic}. Return JSON: {"title":"...","summary":"...","importance":1-10,"sentiment":"positive|negative|neutral"}`
        }],
        max_tokens: 300,
        temperature: 0.3,
      });

      const raw = result.choices[0].message.content.replace(/```json|```/g, '').trim();
      const data = JSON.parse(raw);

      await pool.query(
        `INSERT INTO intelligence_raw (agent_name, content_type, raw_content, title, category, importance_score, sentiment, is_verified, collected_at)
         VALUES ('china_news_agent','news',$1,$2,'chinese_ai',$3,$4,false,NOW())`,
        [data.summary, data.title, data.importance || 5, data.sentiment || 'neutral']
      ).catch(() => {});

      totalProcessed++;
      console.log(`✅ ${topic}: importance=${data.importance}`);
      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      console.error(`⚠️ ${topic}: ${e.message}`);
    }
  }

  await pool.query(`UPDATE agent_registry SET status='active', last_run=NOW(), run_count=COALESCE(run_count,0)+1 WHERE agent_name='china_news_agent'`).catch(() => {});
  console.log(`\n🏁 China News Agent Complete: ${totalProcessed}/${topics.length} topics processed`);

  if (process.argv[1]?.includes('intelligence/china-news-agent.js')) {
    await pool.end();
  }
}

// ── export للـregistry/scheduler ────────────────────────────────
export async function run(input = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM intelligence_raw WHERE agent_name='china_news_agent' AND collected_at > NOW() - INTERVAL '24 hours'`
    );
    return {
      success: true,
      data: {
        agent: 'china_news_agent',
        articles_24h: parseInt(rows[0].cnt),
        status: 'ready',
        confidence: 85
      }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

export default { name: 'china_news_agent', layer: 'intelligence', run };

// ── standalone ───────────────────────────────────────────────────
const isMain = process.argv[1]?.includes('intelligence/china-news-agent.js');
if (isMain) {
  runStandalone().catch(async err => {
    console.error('FATAL:', err.message);
    await pool.query(
      `INSERT INTO agent_circuit_breaker (agent_name, state, failure_count, last_failure)
       VALUES ('china_news_agent','open',1,NOW())
       ON CONFLICT (agent_name) DO UPDATE SET
         failure_count=agent_circuit_breaker.failure_count+1,
         last_failure=NOW()`
    ).catch(() => {});
    process.exit(1);
  });
}
