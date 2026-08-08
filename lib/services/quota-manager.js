/**
 * TRUNKIA Atomic Quota Manager v2.0 (Omega Protocol - Cloud Edition)
 * Three-Tier Fallback: Redis (Distributed) → PostgreSQL (Single) → Local (Testing).
 * Lua Script for Atomic Hold. TTL for Crash Recovery. Idempotency Guard.
 */
import { createRequire } from 'module';
import { getPool, generateDbToken } from '../db.js';

const require = createRequire(import.meta.url);
let RedisClient = null;
try { RedisClient = require('ioredis'); } catch (e) {}

// Lua Script: Atomic check-and-decrement with TTL hold
const HOLD_LUA = `
local remaining = tonumber(redis.call('GET', KEYS[1]) or '1000000')
if remaining < tonumber(ARGV[1]) then
  return -1
end
local newRemaining = redis.call('DECRBY', KEYS[1], ARGV[1])
redis.call('SETEX', KEYS[2], 300, ARGV[1])
return newRemaining
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
        this.redis = new RedisClient(process.env.REDIS_URL, {
          retryStrategy: (t) => Math.min(t * 50, 2000),
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          connectTimeout: 5000
        });
        this.redis.on('error', (e) => console.warn('[QUOTA] Redis error:', e.message));
        this.redis.on('connect', () => console.log('[QUOTA] Redis connected. Distributed quota mode active.'));
      } catch (e) {
        console.warn('[QUOTA] Redis init failed.');
        this.redis = null;
      }
    }
  }

  initPg() {
    try {
      this.pool = getPool('main', generateDbToken('lib/services/quota-manager.js'));
    } catch (e) {
      console.warn('[QUOTA] PG init failed. Local-only mode.');
      this.pool = null;
    }
  }

  async holdQuota(userId, amount, requestId) {
    if (!userId || amount <= 0) return { success: false, error: 'INVALID_INPUT' };

    // Tier 1: Redis (Distributed)
    if (this.redis) {
      try {
        const newRemaining = await this.redis.eval(HOLD_LUA, 2, `quota:${userId}`, `hold:${requestId}`, amount);
        if (newRemaining === -1) return { success: false, error: 'INSUFFICIENT_QUOTA' };
        return { success: true, heldAmount: amount, remaining: newRemaining, mode: 'redis' };
      } catch (e) {
        console.warn('[QUOTA] Redis hold failed, falling back:', e.message);
      }
    }

    // Tier 2: PostgreSQL (Single Instance)
    if (this.pool) {
      try {
        const res = await this.pool.query(
          `UPDATE user_quota 
           SET remaining_quota = remaining_quota - $1, held_quota = held_quota + $1 
           WHERE user_id = $2 AND remaining_quota >= $1 
           RETURNING remaining_quota;`,
          [amount, userId]
        );
        if (res.rows.length === 0) return { success: false, error: 'INSUFFICIENT_QUOTA' };
        return { success: true, heldAmount: amount, remaining: res.rows[0].remaining_quota, mode: 'pg' };
      } catch (e) {
        console.warn('[QUOTA] PG hold failed, falling back:', e.message);
      }
    }

    // Tier 3: Local Memory (Testing)
    const current = this.localQuota.get(userId) ?? 1000000;
    if (current < amount) return { success: false, error: 'INSUFFICIENT_QUOTA' };
    this.localQuota.set(userId, current - amount);
    this.localQuota.set(`hold:${requestId}`, amount);
    return { success: true, heldAmount: amount, remaining: this.localQuota.get(userId), mode: 'local' };
  }

  async settleQuota(userId, heldAmount, actualCost, requestId) {
    if (!userId || heldAmount <= 0) return { success: false, error: 'INVALID_INPUT' };

    // Idempotency Guard
    if (this.settledRequests.has(requestId)) {
      return { success: true, refunded: 0, charged: 0, idempotent: true };
    }

    const safeCost = Math.max(0, Math.min(actualCost, heldAmount));
    const refund = heldAmount - safeCost;

    // Tier 1: Redis
    if (this.redis) {
      try {
        const held = await this.redis.get(`hold:${requestId}`);
        if (!held) {
          // Hold expired (crash recovery)
          this.settledRequests.add(requestId);
          return { success: true, refunded: 0, charged: safeCost, expired: true, mode: 'redis' };
        }
        if (refund > 0) await this.redis.incrby(`quota:${userId}`, refund);
        await this.redis.del(`hold:${requestId}`);
        
        // Audit Trail (PG)
        if (this.pool) {
          try {
            await this.pool.query(
              `INSERT INTO quota_audit (user_id, request_id, held_amount, actual_cost, refund, settled_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (request_id) DO NOTHING;`,
              [userId, requestId, heldAmount, safeCost, refund]
            );
          } catch (e) {}
        }

        this.settledRequests.add(requestId);
        return { success: true, refunded: refund, charged: safeCost, mode: 'redis' };
      } catch (e) {
        console.warn('[QUOTA] Redis settle failed, falling back:', e.message);
      }
    }

    // Tier 2: PostgreSQL
    if (this.pool) {
      try {
        const res = await this.pool.query(
          `UPDATE user_quota 
           SET remaining_quota = remaining_quota + $1, 
               held_quota = held_quota - $2,
               total_consumed = total_consumed + $3
           WHERE user_id = $4 
           RETURNING remaining_quota;`,
          [refund, heldAmount, safeCost, userId]
        );
        if (res.rows.length === 0) return { success: false, error: 'USER_NOT_FOUND' };
        this.settledRequests.add(requestId);
        return { success: true, refunded: refund, charged: safeCost, remaining: res.rows[0].remaining_quota, mode: 'pg' };
      } catch (e) {
        console.warn('[QUOTA] PG settle failed, falling back:', e.message);
      }
    }

    // Tier 3: Local
    const current = this.localQuota.get(userId) ?? 0;
    this.localQuota.set(userId, current + refund);
    this.localQuota.delete(`hold:${requestId}`);
    this.settledRequests.add(requestId);
    return { success: true, refunded: refund, charged: safeCost, mode: 'local' };
  }

  async getQuota(userId) {
    if (this.redis) {
      try {
        const remaining = await this.redis.get(`quota:${userId}`);
        if (remaining !== null) return { remaining: parseInt(remaining), mode: 'redis' };
      } catch (e) {}
    }
    if (this.pool) {
      try {
        const res = await this.pool.query('SELECT remaining_quota FROM user_quota WHERE user_id = $1', [userId]);
        if (res.rows.length > 0) return { remaining: res.rows[0].remaining_quota, mode: 'pg' };
      } catch (e) {}
    }
    return { remaining: this.localQuota.get(userId) ?? 1000000, mode: 'local' };
  }

  async health() {
    const status = { redis: false, pg: false, mode: 'local' };
    if (this.redis) {
      try { await this.redis.ping(); status.redis = true; status.mode = 'distributed'; } catch (e) {}
    }
    if (this.pool) {
      try { await this.pool.query('SELECT 1'); status.pg = true; if (!status.redis) status.mode = 'single'; } catch (e) {}
    }
    return status;
  }
}

const quotaManager = new QuotaManager();

export const holdQuota = (userId, amount, requestId) => quotaManager.holdQuota(userId, amount, requestId);
export const settleQuota = (userId, heldAmount, actualCost, requestId) => quotaManager.settleQuota(userId, heldAmount, actualCost, requestId);
export const getQuota = (userId) => quotaManager.getQuota(userId);
export const health = () => quotaManager.health();
export default { holdQuota, settleQuota, getQuota, health };
