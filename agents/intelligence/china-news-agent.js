import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SOURCES = [
  { name: 'Jiqizhixin', url: 'https://www.jiqizhixin.com', lang: 'zh' },
  { name: 'Leiphone', url: 'https://www.leiphone.com', lang: 'zh' },
  { name: 'Synced', url: 'https://syncedreview.com', lang: 'en' },
];

async function run() {
  console.log('🔍 China News Agent Starting...');
  
  await pool.query(`UPDATE agent_registry SET status='running', last_run=NOW() WHERE agent_name='china_news_agent'`).catch(() => {});
  await pool.query(`INSERT INTO agent_heartbeat (agent_name, status, last_ping) VALUES ('china_news_agent','alive',NOW()) ON CONFLICT DO NOTHING`).catch(() => {});
  await pool.query(`UPDATE agent_heartbeat SET status='alive', last_ping=NOW() WHERE agent_name='china_news_agent'`).catch(() => {});

  const topics = ['DeepSeek', 'Qwen', 'Baidu ERNIE', 'Huawei Pangu', 'Zhipu AI', 'MiniMax', 'Moonshot AI', 'ByteDance AI'];
  
  let totalProcessed = 0;
  
  for (const topic of topics) {
    try {
      const analysis = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: 'You are a China AI intelligence analyst. Provide factual, current analysis in JSON format only. No markdown.'
        }, {
          role: 'user',
          content: `Analyze the latest developments for ${topic} Chinese AI. Return JSON: {"title":"...","summary":"...","importance":1-10,"category":"model|company|policy|research","sentiment":"positive|neutral|negative","key_facts":["..."],"source_type":"analysis"}`
        }],
        max_tokens: 500,
        temperature: 0.3,
      });

      const raw = analysis.choices[0].message.content.replace(/```json|```/g, '').trim();
      const data = JSON.parse(raw);
      
      await pool.query(`
        INSERT INTO intelligence_raw 
        (agent_name, source_name, title, content, category, importance_score, sentiment, language, metadata, collected_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT DO NOTHING`,
        ['china_news_agent', topic, data.title, data.summary, data.category, data.importance, data.sentiment, 'en', JSON.stringify({ key_facts: data.key_facts, source_type: data.source_type })]
      );
      
      totalProcessed++;
      console.log(`✅ Processed: ${topic} (importance: ${data.importance})`);
      
      await new Promise(r => setTimeout(r, 1000));
    } catch(err) {
      console.error(`❌ Failed: ${topic} — ${err.message}`);
      await pool.query(`INSERT INTO agent_dead_letter (agent_name, task_type, payload, error_message) VALUES ($1,$2,$3,$4)`,
        ['china_news_agent', 'topic_analysis', JSON.stringify({ topic }), err.message]).catch(() => {});
    }
  }

  await pool.query(`UPDATE agent_registry SET status='active', last_run=NOW(), run_count=COALESCE(run_count,0)+1 WHERE agent_name='china_news_agent'`).catch(() => {});
  
  console.log(`\n🏁 China News Agent Complete: ${totalProcessed}/${topics.length} topics processed`);
  // حماية: لا تنفّذ عند import
if (process.argv[1] && process.argv[1].endsWith('intelligence/china-news-agent.js')) {
  await pool.end();
}
}

run().catch(async err => {
  console.error('FATAL:', err.message);
  await pool.query(`INSERT INTO agent_circuit_breaker (agent_name, state, failure_count, last_failure) VALUES ('china_news_agent','open',1,NOW()) ON CONFLICT (agent_name) DO UPDATE SET failure_count=agent_circuit_breaker.failure_count+1, last_failure=NOW(), state=CASE WHEN agent_circuit_breaker.failure_count>=2 THEN 'open' ELSE 'half-open' END`).catch(() => {});
  process.exit(1);
});

export async function run(input = {}) {
  try {
    return { success: true, data: { status: 'standalone', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

export default { name: 'china-news-agent', run };
