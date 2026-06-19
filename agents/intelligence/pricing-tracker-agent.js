import dotenv from 'dotenv'; dotenv.config();
import { pool } from '../utils/db.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
async function runStandalone() {
  console.log('💰 Pricing Tracker Agent Starting...');
  await pool.query(`UPDATE agent_registry SET status='running', last_run=NOW() WHERE agent_name='pricing_tracker_agent'`).catch(() => {});
  await pool.query(`INSERT INTO agent_heartbeat (agent_name, status, last_ping) VALUES ('pricing_tracker_agent','alive',NOW()) ON CONFLICT (agent_name) DO UPDATE SET status='alive', last_ping=NOW()`).catch(() => {});

  const models = [
    { name: 'DeepSeek-V3', vendor: 'DeepSeek' },
    { name: 'Qwen-Max', vendor: 'Alibaba' },
    { name: 'ERNIE-4.0', vendor: 'Baidu' },
    { name: 'Hunyuan-Pro', vendor: 'Tencent' },
    { name: 'GLM-4', vendor: 'Zhipu AI' },
    { name: 'Moonshot-v1', vendor: 'Moonshot AI' },
    { name: 'MiniMax-Text', vendor: 'MiniMax' },
    { name: 'Doubao-Pro', vendor: 'ByteDance' },
  ];

  let processed = 0;
  for (const model of models) {
    try {
      const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: 'You are a China AI pricing analyst. Return accurate pricing data in JSON only.'
        }, {
          role: 'user',
          content: `Get current pricing for ${model.name} by ${model.vendor}. Return JSON: {"input_per_1m_tokens_usd":0.00,"output_per_1m_tokens_usd":0.00,"context_window":0,"free_tier":true/false,"api_available":true/false,"china_only":true/false,"notes":"..."}`
        }],
        max_tokens: 300,
        temperature: 0.1,
      });

      const raw = result.choices[0].message.content.replace(/```json|```/g, '').trim();
      const data = JSON.parse(raw);

      await pool.query(`
        INSERT INTO intelligence_raw (agent_name, source_name, title, content, category, importance_score, sentiment, language, metadata)
        VALUES ($1,$2,$3,$4,'pricing',7,'neutral','en',$5)`,
        ['pricing_tracker_agent', model.vendor, `${model.name} Pricing Update`, 
         `Input: $${data.input_per_1m_tokens_usd}/1M tokens | Output: $${data.output_per_1m_tokens_usd}/1M tokens | Context: ${data.context_window} tokens`,
         JSON.stringify(data)]
      );
      processed++;
      console.log(`✅ ${model.name}: $${data.input_per_1m_tokens_usd}/$${data.output_per_1m_tokens_usd} per 1M tokens`);
      await new Promise(r => setTimeout(r, 800));
    } catch(err) {
      console.error(`❌ ${model.name}: ${err.message}`);
    }
  }

  await pool.query(`UPDATE agent_registry SET status='active', last_run=NOW(), run_count=COALESCE(run_count,0)+1 WHERE agent_name='pricing_tracker_agent'`).catch(() => {});
  console.log(`\n🏁 Pricing Tracker Complete: ${processed}/${models.length} models processed`);
  // حماية: لا تنفّذ عند import
if (process.argv[1] && process.argv[1].endsWith('intelligence/pricing-tracker-agent.js')) {
  await pool.end();
}
}

const isMain = process.argv[1]?.includes('intelligence/pricing-tracker-agent.js');
if (isMain) {
  runStandalone().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
}

export async function run(input = {}) {
  try {
    return { success: true, data: { status: 'standalone', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

export default { name: 'pricing-tracker-agent', run };
