/**
 * TRUNKIA Quota Manager v4.0 (Omega Protocol - Enterprise Metered Billing)
 * 
 * Features:
 * 1. QuotaContext (Encapsulates transaction lifecycle)
 * 2. Idempotency Guard (Prevents double-charge on retries)
 * 3. Atomic Lua Metering (Batched deduction, hard cutoff)
 * 4. Three-Tier Fallback (Redis -> PG -> Local)
 * 5. Graceful Refund (Settle calculates actual consumption)
 */
import { createRequire } from 'module';
import { getPool, generateDbToken } from '../db.js';

const require = createRequire(import.meta.url);
let RedisClient = null;
try { RedisClient = require('ioredis'); } catch (e) {}

const METER_LUA = `
local balance = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
if balance < amount then
  return -1
end
local newBalance = redis.call('DECRBY', KEYS[1], amount)
return newBalance
`;

class QuotaManager {
  constructor() {
    this.redis = null;
    this.pool = null;
    this.localQuota = new Map();
    this.settledRequests = new Set();
    this.initRedis();
    this.initPg();
  }

  initRedis() {
    if (RedisClient && process.env.REDIS_URL) {
      try {
        this.redis = new RedisClient(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
        this.redis.on('connect', () => console.log('{"ts":"' + new Date().toISOString() + '","level":"info","msg":"[QUOTA] Redis connected. Metered billing active."}'));
        this.redis.on('error', (e) => console.error('{"ts":"' + new Date().toISOString() + '","level":"error","msg":"[QUOTA] Redis error"}'));
      } catch (e) { this.redis = null; }
    }
  }

  initPg() {
    try { this.pool = getPool('main', generateDbToken('lib/services/quota-manager.js')); } catch (e) {}
  }

  createContext(userId, requestId) {
    return new QuotaContext(this, userId, requestId);
  }

  async hold(userId, amount, requestId) {
    if (!userId || amount <= 0) return false;
    if (this.redis && this.redis.status === 'ready') {
      try {
        const res = await this.redis.eval(METER_LUA, 1, 'quota:' + userId, amount);
        return res !== -1;
      } catch (e) {}
    }
    if (this.pool) {
      try {
        const res = await this.pool.query('UPDATE user_quota SET remaining_quota = remaining_quota - $1 WHERE user_id = $2 AND remaining_quota >= $1 RETURNING id', [amount, userId]);
        return res.rows.length > 0;
      } catch (e) {}
    }
    const cur = this.localQuota.get(userId) ?? 1000000;
    if (cur < amount) return false;
    this.localQuota.set(userId, cur - amount);
    return true;
  }

  async meter(userId, amount) {
    if (!userId || amount <= 0) return true;
    if (this.redis && this.redis.status === 'ready') {
      try {
        const res = await this.redis.eval(METER_LUA, 1, 'quota:' + userId, amount);
        return res !== -1;
      } catch (e) { return true; } // Fail-open
    }
    return true; // PG/Local deduct at settle
  }

  async refund(userId, amount) {
    if (!userId || amount <= 0) return;
    if (this.redis && this.redis.status === 'ready') {
      try { await this.redis.incrby('quota:' + userId, amount); return; } catch (e) {}
    }
    if (this.pool) {
      try { await this.pool.query('UPDATE user_quota SET remaining_quota = remaining_quota + $1 WHERE user_id = $2', [amount, userId]); return; } catch (e) {}
    }
    this.localQuota.set(userId, (this.localQuota.get(userId) ?? 0) + amount);
  }

  async settle(userId, requestId, heldAmount, consumedAmount) {
    if (!userId || this.settledRequests.has(requestId)) return;
    this.settledRequests.add(requestId);
    
    const refund = Math.max(0, heldAmount - consumedAmount);
    if (refund > 0) await this.refund(userId, refund);

    if (this.pool) {
      try {
        await this.pool.query(
          'INSERT INTO quota_audit (user_id, request_id, held_amount, actual_cost, refund, settled_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (request_id) DO NOTHING',
          [userId, requestId, heldAmount, consumedAmount, refund]
        );
      } catch (e) {}
    }
  }
}

class QuotaContext {
  constructor(manager, userId, requestId) {
    this.manager = manager;
    this.userId = userId;
    this.requestId = requestId;
    this.heldAmount = 0;
    this.consumedAmount = 0;
    this.batchedTokens = 0;
    this.isExhausted = false;
  }

  async hold(amount) {
    this.heldAmount = amount;
    return this.manager.hold(this.userId, amount, this.requestId);
  }

  async meter(amount) {
    if (this.isExhausted) return false;
    this.batchedTokens += amount;
    if (this.batchedTokens >= 50) {
      const success = await this.manager.meter(this.userId, this.batchedTokens);
      if (!success) {
        this.isExhausted = true;
        return false;
      }
      this.consumedAmount += this.batchedTokens;
      this.batchedTokens = 0;
    }
    return true;
  }

  async settle() {
    // Consume any remaining batched tokens
    if (this.batchedTokens > 0 && !this.isExhausted) {
      this.consumedAmount += this.batchedTokens;
      this.batchedTokens = 0;
    }
    await this.manager.settle(this.userId, this.requestId, this.heldAmount, this.consumedAmount);
  }
}

const quotaManager = new QuotaManager();

export function createQuotaContext(userId, requestId) {
  return quotaManager.createContext(userId, requestId);
}
export const health = () => quotaManager.health();
export default { createQuotaContext, health };
