import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { checkAndAlert } from './agents/utils/alert-engine.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Pipeline تعريف ───────────────────────────────────────────────
const PIPELINES = [
  {
    name: 'core-intelligence',
    interval_ms: 6 * 60 * 60000,
    agents: [
      './agents/intelligence/china-news-agent.js',
      './agents/governance/verification-agent.js',
      './agents/intelligence/pricing-tracker-agent.js',
    ]
  },
  {
    name: 'analysis-pipeline',
    interval_ms: 3 * 60 * 60000,
    agents: [
      './agents/analysis/trend-analysis-agent.js',
      './agents/analysis/sentiment-agent.js',
      './agents/analysis/risk-assessment-agent.js',
      './agents/analysis/competitive-intel-agent.js',
      './agents/analysis/market-signal-agent.js',
    ]
  },
  {
    name: 'learning-pipeline',
    interval_ms: 4 * 60 * 60000,
    agents: [
      './agents/learning/pattern-learner-agent.js',
      './agents/learning/feedback-agent.js',
      './agents/learning/model-evaluator-agent.js',
      './agents/learning/memory-consolidator-agent.js',
    ]
  },
  {
    name: 'service-pipeline',
    interval_ms: 2 * 60 * 60000,
    agents: [
      './agents/service/market-data-agent.js',
      './agents/service/currency-agent.js',
      './agents/service/news-aggregator-agent.js',
    ]
  }
];

// ── تشغيل pipeline واحد بالتسلسل ────────────────────────────────
async function runPipeline(pipeline) {
  console.log(`\n🚀 Pipeline [${pipeline.name}] started — ${new Date().toISOString()}`);
  const results = [];

  for (const agentPath of pipeline.agents) {
    try {
      const mod = await import(agentPath);
      const agent = mod.default || Object.values(mod)[0];
      if (!agent) throw new Error('no_export');

      const start = Date.now();
      const result = await agent.run({});
      const duration = Date.now() - start;

      results.push({
        agent: agentPath.split('/').pop(),
        success: result?.success ?? false,
        duration_ms: duration
      });

      await pool.query(`
        INSERT INTO agent_execution_logs
          (agent_name, action, input, output, confidence, status, duration_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        agentPath.split('/').pop().replace('.js',''),
        `cron_${pipeline.name}`,
        JSON.stringify({ pipeline: pipeline.name }),
        JSON.stringify(result?.data || {}),
        75,
        result?.success ? 'completed' : 'failed',
        duration
      ]).catch(() => {});

      console.log(`  ✅ ${agentPath.split('/').pop()} — ${duration}ms`);

    } catch(e) {
      results.push({ agent: agentPath.split('/').pop(), success: false, error: e.message });
      console.warn(`  ⚠️  ${agentPath.split('/').pop()} — ${e.message}`);
    }
  }

  // alert check بعد كل pipeline
  await checkAndAlert().catch(() => {});

  const success = results.filter(r => r.success).length;
  console.log(`✅ Pipeline [${pipeline.name}] done — ${success}/${results.length} succeeded`);
  return results;
}

// ── جدولة كل pipeline ───────────────────────────────────────────
async function start() {
  console.log('⏱️  Cron Runner starting —', PIPELINES.length, 'pipelines');

  for (const pipeline of PIPELINES) {
    // تشغيل فوري
    runPipeline(pipeline);

    // جدولة دورية
    setInterval(() => runPipeline(pipeline), pipeline.interval_ms);

    console.log(`  📌 [${pipeline.name}] every ${pipeline.interval_ms / 60000}min`);
  }
}

start();
