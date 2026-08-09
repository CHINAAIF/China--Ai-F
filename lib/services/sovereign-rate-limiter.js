/**
 * TRUNKIA Sovereign Rate Limiter & DB Circuit Breaker v3.0 (Omega Protocol)
 * 
 * Complete Rewrite for Cloud Enterprise:
 * 1. Distributed Token Bucket via Redis Lua Script (Atomic, Multi-Pod safe)
 * 2. Fail-Open on Redis Outage (Availability over Security)
 * 3. Local Fallback for Staging/Termux
 * 4. Native Security Exemption (Honeypot)
 * 5. DB Circuit Breaker & Pool Monitor
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let RedisClient = null;
try { RedisClient = require('ioredis'); } catch (e) {}

// Lua Script: Atomic Token Bucket
// KEYS[1] = bucket key
// ARGV[1] = refillPerMin, ARGV[2] = burst, ARGV[3] = now_ms, ARGV[4] = cost(1)
const TOKEN_BUCKET_LUA = `
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or tonumber(ARGV[2])
local last_refill = tonumber(bucket[2]) or tonumber(ARGV[3])
local now = tonumber(ARGV[3])
local refill_per_ms = tonumber(ARGV[1]) / 60000
local burst = tonumber(ARGV[2])

local elapsed = now - last_refill
local refilled = elapsed * refill_per_ms
tokens = math.min(burst, tokens + refilled)

local allowed = 0
local remaining = tokens
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
  remaining = tokens
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', KEYS[1], 300)
return {allowed, remaining}
`;

const EXEMPT_PATHS = [
  '/api/supervisor', '/api/self-heal', '/api/scheduler', 
  '/api/system', '/api/llm', '/api/sovereign/rate-limiter'
];

class SovereignRateLimiter {
  constructor() {
    this.redis = null;
    this.localBuckets = new Map();
    this.circuitState = 'CLOSED';
    this.circuitFailures = 0;
    this.circuitLastFailure = 0;
    this.circuitResetMs = 30000;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.pool = null;
    this.initRedis();
  }

  initRedis() {
    if (RedisClient && process.env.REDIS_URL) {
      try {
        this.redis = new RedisClient(process.env.REDIS_URL, {
          retryStrategy: (t) => Math.min(t * 50, 2000),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2000
        });
        this.redis.on('error', (e) => console.warn('[RATE LIMITER] Redis error (Failing open):', e.message));
        this.redis.on('connect', () => console.log('[RATE LIMITER] Redis connected. Distributed mode active.'));
      } catch (e) {
        console.warn('[RATE LIMITER] Redis init failed. Local-only mode.');
        this.redis = null;
      }
    }
  }

  setPool(pool) { this.pool = pool; }

  async checkLimit(key, refillPerMin, burst) {
    const now = Date.now();
    
    // Distributed Mode (Redis)
    if (this.redis && this.redis.status === 'ready') {
      try {
        const result = await this.redis.eval(TOKEN_BUCKET_LUA, 1, key, refillPerMin, burst, now, 1);
        return {
          allowed: result[0] === 1,
          remaining: parseInt(result[1], 10),
          resetMs: result[0] === 1 ? 0 : Math.ceil((1 - result[1]) / (refillPerMin / 60000))
        };
      } catch (e) {
        // Fail-Open: If Redis fails mid-request, allow the request but log critical warning
        console.error('[RATE LIMITER] Redis eval failed! Failing OPEN (allowing request).');
        return { allowed: true, remaining: 99, resetMs: 0 };
      }
    }

    // Local Fallback Mode (Termux or Redis down)
    let bucket = this.localBuckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: now, refillPerMs: refillPerMin / 60000, burst };
      this.localBuckets.set(key, bucket);
    }
    
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + (elapsed * bucket.refillPerMs));
    bucket.lastRefill = now;
    
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    
    return {
      allowed: allowed,
      remaining: Math.floor(bucket.tokens),
      resetMs: allowed ? 0 : Math.ceil((1 - bucket.tokens) / bucket.refillPerMs)
    };
  }

  middleware(options) {
    const opts = options || {};
    const globalRefill = opts.globalRefill || 120;
    const globalBurst = opts.globalBurst || 200;
    const userRefill = opts.userRefill || 60;
    const userBurst = opts.userBurst || 100;

    return async (req, res, next) => {
      // 1. Native Exemption
      for (const exempt of EXEMPT_PATHS) {
        if (req.path && req.path.startsWith(exempt)) return next();
      }

      // 2. DB Circuit Breaker
      const circuit = this.checkCircuit();
      if (!circuit.allowed) {
        return res.status(503).json({ error: 'Service temporarily unavailable', reason: 'CIRCUIT_OPEN' });
      }

      // 3. Pool Pressure
      const pool = this.checkPoolPressure();
      if (!pool.allowed) {
        return res.status(503).json({ error: 'Service under high load', reason: 'POOL_EXHAUSTED' });
      }

      const ip = req.headers['cf-connecting-ip'] || req.realIp || (req.socket && req.socket.remoteAddress) || '0.0.0.0';
      const userId = (req.authResult && req.authResult.userId) || ip;

      // 4. Global Limit
      const globalCheck = await this.checkLimit('GLOBAL', globalRefill, globalBurst);
      if (!globalCheck.allowed) {
        res.setHeader('Retry-After', Math.ceil(globalCheck.resetMs / 1000));
        return res.status(429).json({ error: 'Too many requests', reason: 'GLOBAL_RATE_LIMIT' });
      }

      // 5. Per-User Limit
      const userCheck = await this.checkLimit('USER:' + userId, userRefill, userBurst);
      if (!userCheck.allowed) {
        res.setHeader('Retry-After', Math.ceil(userCheck.resetMs / 1000));
        return res.status(429).json({ error: 'Too many requests', reason: 'USER_RATE_LIMIT' });
      }

      res.setHeader('X-RateLimit-Remaining', Math.min(globalCheck.remaining, userCheck.remaining));
      next();
    };
  }

  checkCircuit() {
    const now = Date.now();
    if (this.circuitState === 'OPEN') {
      if (now - this.circuitLastFailure > this.circuitResetMs) {
        this.circuitState = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        this.halfOpenSuccesses = 0;
      } else {
        return { allowed: false };
      }
    }
    if (this.circuitState === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= 3) return { allowed: false };
      this.halfOpenAttempts++;
    }
    return { allowed: true };
  }

  recordSuccess() {
    if (this.circuitState === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= 3) {
        this.circuitState = 'CLOSED';
        this.circuitFailures = 0;
        this.circuitResetMs = 30000;
      }
    } else if (this.circuitState === 'CLOSED') {
      this.circuitFailures = 0;
    }
  }

  recordFailure() {
    this.circuitFailures++;
    this.circuitLastFailure = Date.now();
    if (this.circuitState === 'HALF_OPEN') {
      this.circuitState = 'OPEN';
      this.circuitResetMs = Math.min(300000, this.circuitResetMs * 2);
    } else if (this.circuitFailures >= 5) {
      this.circuitState = 'OPEN';
    }
  }

  checkPoolPressure() {
    if (!this.pool) return { allowed: true, pressure: 0 };
    const total = this.pool.totalCount || 0;
    const idle = this.pool.idleCount || 0;
    if (total === 0) return { allowed: true, pressure: 0 };
    const pressure = (total - idle) / total;
    if (pressure >= 0.95) return { allowed: false, pressure };
    return { allowed: true, pressure };
  }

  getStatus() {
    return {
      circuit: { state: this.circuitState, failures: this.circuitFailures, resetMs: this.circuitResetMs },
      pool: this.pool ? { total: this.pool.totalCount || 0, idle: this.pool.idleCount || 0 } : null,
      mode: this.redis && this.redis.status === 'ready' ? 'distributed_redis' : 'local_memory'
    };
  }
}

const limiter = new SovereignRateLimiter();

export function rateLimitMiddleware(options) { return limiter.middleware(options); }
export function getRateLimiterStatus() { return limiter.getStatus(); }
export function setRateLimiterPool(pool) { limiter.setPool(pool); }
export function recordDBSuccess() { limiter.recordSuccess(); }
export function recordDBFailure() { limiter.recordFailure(); }
export function destroyRateLimiter() { if (limiter.redis) limiter.redis.quit(); }
export default { rateLimitMiddleware, getRateLimiterStatus, setRateLimiterPool, recordDBSuccess, recordDBFailure, destroyRateLimiter };
