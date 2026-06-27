import { pool } from './db.js';
import crypto from 'crypto';

const SOVEREIGN_SYSTEM_USER_ID = 'a0000000-0000-4000-a000-000000000001';

// ─────────────────────────────────────────────────────────────
// SOVEREIGN IAM & FINANCIAL SHIELD
// ─────────────────────────────────────────────────────────────

export async function validateApiKeyAndQuota(rawKey) {
  if (!rawKey || !rawKey.startsWith('sk-trunkia-')) {
    throw { code: 401, message: 'MISSING_OR_INVALID_KEY' };
  }

  const client = await pool.connect();
  try {
    const keyRes = await client.query(
      "SELECT id, user_id, status, scopes, metadata FROM api_keys WHERE key = $1 AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())",
      [rawKey]
    );

    if (keyRes.rows.length === 0) {
      throw { code: 401, message: 'INVALID_OR_EXPIRED_KEY' };
    }

    const apiKey = keyRes.rows[0];
    const userId = apiKey.user_id;

    const dailyLimit = apiKey.metadata?.daily_limit_usd || 1.00;
    const costRes = await client.query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total_spent FROM cost_tracking WHERE agent_name = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [apiKey.id]
    );

    const totalSpent = parseFloat(costRes.rows[0].total_spent);
    if (totalSpent >= dailyLimit) {
      throw { code: 402, message: 'DAILY_FINANCIAL_LIMIT_EXCEEDED', spent: totalSpent.toFixed(4), limit: dailyLimit };
    }

    const bucketKey = 'user:' + userId + ':inference';
    const tokensRes = await client.query(
      "INSERT INTO rate_limit_buckets (bucket_key, tokens, max_tokens, refill_rate, last_refill_at) " +
      "VALUES ($1, 20, 20, 1, NOW()) " +
      "ON CONFLICT (bucket_key) DO UPDATE SET " +
      "tokens = LEAST(max_tokens, rate_limit_buckets.tokens + (EXTRACT(EPOCH FROM (NOW() - rate_limit_buckets.last_refill_at)) * rate_limit_buckets.refill_rate)), " +
      "last_refill_at = NOW() " +
      "RETURNING tokens, max_tokens",
      [bucketKey]
    );

    const currentTokens = parseFloat(tokensRes.rows[0].tokens);
    if (currentTokens < 1) {
      throw { code: 429, message: 'RATE_LIMIT_EXCEEDED' };
    }

    await client.query(
      "UPDATE rate_limit_buckets SET tokens = GREATEST(0, tokens - 1) WHERE bucket_key = $1",
      [bucketKey]
    );

    client.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [apiKey.id]).catch(() => {});

    return { valid: true, apiKeyId: apiKey.id, userId, remainingTokens: currentTokens - 1 };

  } catch (err) {
    throw err;
  } finally {
    client.release();
  }
}

export async function generateNewApiKey(userId, dailyLimit = 1.00) {
  const rawKey = 'sk-trunkia-' + crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [SOVEREIGN_SYSTEM_USER_ID, 'sovereign-system@trunkia.internal']
    );
    await client.query(
      "INSERT INTO api_keys (id, user_id, name, key, status, scopes, metadata, created_at) VALUES (gen_random_uuid(), $1, 'sovereign_gateway', $2, 'active', '{inference}', $3, NOW())",
      [SOVEREIGN_SYSTEM_USER_ID, rawKey, JSON.stringify({ daily_limit_usd: dailyLimit })]
    );
    return rawKey;
  } finally {
    client.release();
  }
}
