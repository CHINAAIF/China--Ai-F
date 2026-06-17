import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import { checkAndAlert } from './agents/utils/alert-engine.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
      './agents/analysis/trend_prediction_agent.js',
      './agents/analysis/sentiment_analysis_agent.js',
      './agents/analysis/price_prediction_agent.js',
      './agents/analysis/competitor_analysis_agent.js',
      './agents/analysis/fact_checker_agent.js',
    ]
  },
  {
    name: 'learning-pipeline',
    interval_ms: 4 * 60 * 60000,
    agents: [
      './agents/learning/learning_agent.js',
      './agents/learning/filter_agent.js',
      './agents/learning/approval_agent.js',
      './agents/learning/verification_agent.js',
    ]
  },
  {
    name: 'service-pipeline',
    interval_ms: 2 * 60 * 60000,
    agents: [
      './agents/service/platform_health_agent.js',
      './agents/service/api_monitor_agent.js',
      './agents/service/db_guardian_agent.js',
      './agents/service/performance_agent.js',
      './agents/service/error_recovery_agent.js',
    ]
  },
  {
    name: 'intelligence-pipeline',
    interval_ms: 5 * 60 * 60000,
    agents: [
      './agents/intelligence/china_policy_agent.js',
      './agents/intelligence/china_company_agent.js',
      './agents/intelligence/china_investment_agent.js',
      './agents/intelligence/global_comparison_agent.js',
      './agents/intelligence/supply_chain_agent.js',
    ]
  },
  {
    name: 'security-pipeline',
    interval_ms: 8 * 60 * 60000,
    agents: [
      './agents/security/threat_monitor_agent.js',
      './agents/security/fraud_detection_agent.js',
      './agents/security/compliance_agent.js',
      './agents/security/cyber_defense_agent.js',
    ]
  },
  {
    name: 'content-pipeline',
    interval_ms: 12 * 60 * 60000,
    agents: [
      './agents/content/content_writer_agent.js',
      './agents/content/seo_agent.js',
      './agents/content/editorial_agent.js',
      './agents/content/summary_agent.js',
    ]
  }
];

async function runPipeline(pipeline) {
  console.log(`\n🚀 [${pipeline.name}] started — ${new Date().toISOString()}`);
  let success = 0;

  for (const agentPath of pipeline.agents) {
    try {
      const mod = await import(agentPath);
      const agent = mod.default || Object.values(mod)[0];
      if (!agent) throw new Error('no_export');

      const start = Date.now();
      const result = await agent.run({});
      const duration = Date.now() - start;

      if (result?.success) success++;

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
      console.warn(`  ⚠️  ${agentPath.split('/').pop()} — ${e.message}`);
    }
  }

  await checkAndAlert().catch(() => {});
  console.log(`✅ [${pipeline.name}] done — ${success}/${pipeline.agents.length}`);
}

async function start() {
  console.log('⏱️  Cron Runner — ', PIPELINES.length, 'pipelines');
  for (const pipeline of PIPELINES) {
    runPipeline(pipeline);
    setInterval(() => runPipeline(pipeline), pipeline.interval_ms);
    console.log(`  📌 [${pipeline.name}] every ${pipeline.interval_ms/60000}min`);
  }
}

start();
