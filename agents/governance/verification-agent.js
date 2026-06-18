import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function run() {
  console.log('⚖️ Verification Agent Starting...');
  await pool.query(`UPDATE agent_registry SET status='running', last_run=NOW() WHERE agent_name='verification_agent'`).catch(() => {});
  await pool.query(`UPDATE agent_heartbeat SET status='alive', last_ping=NOW() WHERE agent_name='verification_agent'`).catch(() => {});

  const { rows: pending } = await pool.query(`SELECT * FROM intelligence_raw WHERE is_verified=false AND is_published=false ORDER BY importance_score DESC, collected_at DESC LIMIT 20`);
  
  console.log(`📋 Found ${pending.length} items to verify`);
  let verified = 0, rejected = 0;

  for (const item of pending) {
    try {
      const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'system',
          content: 'You are a strict AI fact-checker for China AI intelligence. Verify accuracy and return JSON only.'
        }, {
          role: 'user',
          content: `Verify this intelligence: Title: "${item.title}" Content: "${item.content?.substring(0,300)}" Return JSON: {"verified":true/false,"confidence":0-100,"reason":"...","corrected_title":"...","corrected_content":"...","final_importance":1-10}`
        }],
        max_tokens: 400,
        temperature: 0.1,
      });

      const raw = result.choices[0].message.content.replace(/```json|```/g, '').trim();
      const data = JSON.parse(raw);

      if (data.verified && data.confidence >= 60) {
        await pool.query(`UPDATE intelligence_raw SET is_verified=true, is_published=true, title=COALESCE($1,title), content=COALESCE($2,content), importance_score=$3, metadata=jsonb_set(COALESCE(metadata,'{}'), '{verification}', $4) WHERE id=$5`,
          [data.corrected_title, data.corrected_content, data.final_importance, JSON.stringify({ confidence: data.confidence, reason: data.reason }), item.id]);
        verified++;
        console.log(`✅ Verified: ${item.title?.substring(0,50)} (confidence: ${data.confidence}%)`);
      } else {
        await pool.query(`UPDATE intelligence_raw SET filter_status='rejected', metadata=jsonb_set(COALESCE(metadata,'{}'), '{rejection}', $1) WHERE id=$2`,
          [JSON.stringify({ reason: data.reason, confidence: data.confidence }), item.id]);
        rejected++;
        console.log(`❌ Rejected: ${item.title?.substring(0,50)} (reason: ${data.reason})`);
      }
      await new Promise(r => setTimeout(r, 800));
    } catch(err) {
      console.error(`⚠️ Error: ${err.message}`);
    }
  }

  await pool.query(`UPDATE agent_registry SET status='active', last_run=NOW(), run_count=COALESCE(run_count,0)+1 WHERE agent_name='verification_agent'`).catch(() => {});
  console.log(`\n🏁 Verification Complete: ${verified} verified, ${rejected} rejected`);
  await pool.end();
}

run().catch(async err => {
  console.error('FATAL:', err.message);
  await pool.query(`INSERT INTO agent_circuit_breaker (agent_name, state, failure_count, last_failure) VALUES ('verification_agent','open',1,NOW()) ON CONFLICT (agent_name) DO UPDATE SET failure_count=agent_circuit_breaker.failure_count+1, last_failure=NOW()`).catch(() => {});
  process.exit(1);
});

export default { name: 'verification-agent', status: 'standalone' };

export async function run(input = {}) {
  try { return { success: true, data: { status: 'standalone', input } }; }
  catch(e) { return { success: false, error: e.message }; }
}
