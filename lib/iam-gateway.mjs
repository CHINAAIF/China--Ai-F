import { getPool, generateDbToken } from './db.js';
import crypto from 'crypto';

const pool = getPool('main', generateDbToken('lib/iam-gateway.mjs'));
const SOVEREIGN_SYSTEM_USER_ID = 'a0000000-0000-4000-a000-000000000001';

export async function validateApiKeyAndQuota(rawKey) {
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('sk-trunkia-')) {
    return { valid: false, code: 401, message: 'MISSING_OR_INVALID_KEY' };
  }

  const client = await pool.connect();
  try {
    // Start Transaction to ensure RLS context persists for all queries
    await client.query('BEGIN');
    
    // 1. Set Sovereign System Context (Bypass RLS Deadlock for initial lookup)
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [SOVEREIGN_SYSTEM_USER_ID]);

    // 2. Validate Key
    const keyRes = await client.query(
      "SELECT id, user_id, status, scopes, metadata FROM api_keys WHERE key = $1 AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())",
      [rawKey]
    );

    if (keyRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { valid: false, code: 401, message: 'INVALID_OR_EXPIRED_KEY' };
    }

    const apiKey = keyRes.rows[0];
    const userId = apiKey.user_id;

    // 3. Switch Context to the Actual User for subsequent queries
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

    // 4. Rate Limiting (Atomic)
    const bucketKey = 'user:' + userId + ':inference';
    const bucketRes = await client.query(
      "INSERT INTO rate_limit_buckets (bucket_key, requests, window_start, created_at) VALUES ($1, 1, NOW(), NOW()) ON CONFLICT (bucket_key) DO UPDATE SET requests = CASE WHEN rate_limit_buckets.window_start < NOW() - INTERVAL '1 minute' THEN 1 ELSE rate_limit_buckets.requests + 1 END, window_start = CASE WHEN rate_limit_buckets.window_start < NOW() - INTERVAL '1 minute' THEN NOW() ELSE rate_limit_buckets.window_start END RETURNING rate_limit_buckets.requests",
      [bucketKey]
    );

    if (bucketRes.rows[0].requests > 20) {
      await client.query('ROLLBACK');
      return { valid: false, code: 429, message: 'RATE_LIMIT_EXCEEDED' };
    }

    // 5. Commit Transaction
    await client.query('COMMIT');
    
    // Async update last used (doesn't need to block response)
    pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [apiKey.id]).catch(() => {});

    return { valid: true, apiKeyId: apiKey.id, userId, remainingRequests: 20 - bucketRes.rows[0].requests };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[IAM] Validation error:', err.message);
    return { valid: false, code: 500, message: 'INTERNAL_AUTH_ERROR' };
  } finally {
    client.release();
  }
}

export async function generateNewApiKey(userId = SOVEREIGN_SYSTEM_USER_ID, dailyLimit = 1.00) {
  const rawKey = 'sk-trunkia-' + crypto.randomBytes(24).toString('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // RLS Compliance for users table
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [SOVEREIGN_SYSTEM_USER_ID]);
    
    await client.query(
      'INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [SOVEREIGN_SYSTEM_USER_ID, 'sovereign-system@trunkia.internal']
    );
    
    await client.query(
      "INSERT INTO api_keys (id, user_id, name, key, status, scopes, metadata, created_at) VALUES (gen_random_uuid(), $1, 'sovereign_gateway', $2, 'active', '{inference}', $3, NOW())",
      [SOVEREIGN_SYSTEM_USER_ID, rawKey, JSON.stringify({ daily_limit_usd: dailyLimit })]
    );
    
    await client.query('COMMIT');
    return rawKey;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
