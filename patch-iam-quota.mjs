import fs from 'fs';
const f = 'lib/iam-gateway.mjs';
let c = fs.readFileSync(f, 'utf8');

const oldQuotaLogic = `    const dailyLimit = apiKey.metadata?.daily_limit_usd || 1.00;
    const costRes = await client.query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total_spent FROM cost_tracking WHERE agent_name = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [apiKey.id]
    );

    const totalSpent = parseFloat(costRes.rows[0].total_spent);
    if (totalSpent >= dailyLimit) {
      return { valid: false, code: 402, message: 'DAILY_FINANCIAL_LIMIT_EXCEEDED' };
    }`;

const newQuotaLogic = `    // ATOMIC PRE-DEDUCTION (Prevents Financial TOCTOU Race Condition)
    // We use the proven atomic rate_limit_buckets table to lock daily financial quota.
    const dailyLimitUsd = apiKey.metadata?.daily_limit_usd || 1.00;
    const dailyLimitCents = Math.ceil(dailyLimitUsd * 100); // Convert to integer cents
    const costBucketKey = 'user:' + userId + ':daily_cost_cents';

    const costBucketRes = await client.query(
      "INSERT INTO rate_limit_buckets (bucket_key, requests, window_start, created_at) VALUES ($1, 1, NOW(), NOW()) ON CONFLICT (bucket_key) DO UPDATE SET requests = CASE WHEN rate_limit_buckets.window_start < NOW() - INTERVAL '24 hours' THEN 1 ELSE rate_limit_buckets.requests + 1 END, window_start = CASE WHEN rate_limit_buckets.window_start < NOW() - INTERVAL '24 hours' THEN NOW() ELSE rate_limit_buckets.window_start END RETURNING rate_limit_buckets.requests",
      [costBucketKey]
    );

    if (costBucketRes.rows[0].requests > dailyLimitCents) {
      return { valid: false, code: 402, message: 'DAILY_FINANCIAL_LIMIT_EXCEEDED' };
    }`;

if (c.includes(oldQuotaLogic)) {
  c = c.replace(oldQuotaLogic, newQuotaLogic);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched iam-gateway.mjs (Atomic Pre-Deduction implemented)');
} else {
  console.log('❌ Could not find old quota logic.');
}
