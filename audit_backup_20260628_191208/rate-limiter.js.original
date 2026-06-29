import dotenv from 'dotenv';
dotenv.config();
import { pool } from './db.js';

// ── سياسات الحد بالطبقة ──────────────────────────────────────────
const POLICIES = {
  api_global:    { max: 1000, window_ms: 60000  },  // 1000 req/min global
  api_per_ip:    { max: 60,   window_ms: 60000  },  // 60 req/min per IP
  agent_call:    { max: 100,  window_ms: 60000  },  // 100 calls/min per agent
  groq_tokens:   { max: 50,   window_ms: 60000  },  // 50 Groq calls/min
  sovereign:     { max: 10,   window_ms: 60000  },  // 10 sovereign ops/min
};

// ── in-memory fast cache لتجنب DB hit في كل request ─────────────
const localCache = new Map();
const CACHE_TTL  = 5000;

function getCacheKey(bucketKey) {
  const cached = localCache.get(bucketKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;
  return null;
}

export async function checkRateLimit(bucketKey, policyName = 'api_per_ip') {
  const policy = POLICIES[policyName] || POLICIES.api_per_ip;

  // ── fast in-memory check ─────────────────────────────────
  const cached = getCacheKey(bucketKey);
  if (cached?.blocked) {
    return { allowed: false, reason: 'rate_limited', retry_after_ms: cached.retry };
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO rate_limit_buckets (bucket_key, requests, window_start)
      VALUES ($1, 1, NOW())
      ON CONFLICT (bucket_key) DO UPDATE SET
        requests = CASE
          WHEN rate_limit_buckets.window_start < NOW() - ($2 || ' milliseconds')::INTERVAL
          THEN 1
          ELSE rate_limit_buckets.requests + 1
        END,
        window_start = CASE
          WHEN rate_limit_buckets.window_start < NOW() - ($2 || ' milliseconds')::INTERVAL
          THEN NOW()
          ELSE rate_limit_buckets.window_start
        END
      RETURNING requests, window_start, blocked_until
    `, [bucketKey, policy.window_ms]);

    const row = rows[0];

    // فحص blocked_until
    if (row.blocked_until && new Date(row.blocked_until) > new Date()) {
      const retry = new Date(row.blocked_until) - Date.now();
      localCache.set(bucketKey, { blocked: true, retry, ts: Date.now() });
      return { allowed: false, reason: 'blocked', retry_after_ms: retry };
    }

    if (row.requests > policy.max) {
      // فتح الـblock لمدة ضعف الـwindow
      await pool.query(`
        UPDATE rate_limit_buckets
        SET blocked_until = NOW() + ($1 || ' milliseconds')::INTERVAL,
            total_blocked = total_blocked + 1
        WHERE bucket_key = $2
      `, [policy.window_ms * 2, bucketKey]).catch(()=>{});

      localCache.set(bucketKey, { blocked: true, retry: policy.window_ms * 2, ts: Date.now() });
      return { allowed: false, reason: 'limit_exceeded', limit: policy.max, current: row.requests };
    }

    localCache.set(bucketKey, { blocked: false, ts: Date.now() });
    return { allowed: true, remaining: policy.max - row.requests };

  } catch(e) {
    // عند أي خطأ — اسمح بالمرور ولا توقف النظام
    return { allowed: true, error: e.message };
  }
}

export function rateLimitMiddleware(policyName = 'api_per_ip') {
  return async (req, res, next) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const bucketKey = `${policyName}:${ip}`;
      const result = await checkRateLimit(bucketKey, policyName);

      if (!result.allowed) {
        res.setHeader('Retry-After', Math.ceil((result.retry_after_ms || 60000) / 1000));
        res.setHeader('X-RateLimit-Policy', policyName);
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          reason: result.reason,
          retry_after_ms: result.retry_after_ms
        });
      }

      res.setHeader('X-RateLimit-Remaining', result.remaining || 0);
      next();
    } catch(_) {
      next(); // لا توقف النظام
    }
  };
}

export default { checkRateLimit, rateLimitMiddleware };
