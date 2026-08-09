/**
 * TRUNKIA Sovereign Rate Limiter & DB Circuit Breaker v2.2 (Omega Protocol)
 * 
 * Native Security Exemption: adminGuard routes bypass rate limiting.
 * Prevents Information Disclosure (429 on Honeypot routes).
 */
const DEFAULT_GLOBAL_REFILL = 120;
const DEFAULT_GLOBAL_BURST = 200;
const DEFAULT_USER_REFILL = 60;
const DEFAULT_USER_BURST = 100;
const MAX_ENTRIES = 10000;
const CLEANUP_INTERVAL_MS = 60000;
const ENTRY_TTL_MS = 300000;

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_BASE_RESET_MS = 30000;
const CIRCUIT_MAX_RESET_MS = 300000;
const CIRCUIT_HALF_OPEN_MAX = 3;

const QUERY_TIMEOUT_MS = 5000;
const POOL_WARN_THRESHOLD = 0.80;
const POOL_REJECT_THRESHOLD = 0.95;

const EXEMPT_PATHS = [
  '/api/supervisor',
  '/api/self-heal',
  '/api/scheduler',
  '/api/system',
  '/api/llm',
  '/api/sovereign/rate-limiter'
];

class SovereignRateLimiter {
  constructor() {
    this.buckets = new Map();
    this.circuitState = 'CLOSED';
    this.circuitFailures = 0;
    this.circuitLastFailure = 0;
    this.circuitResetMs = CIRCUIT_BASE_RESET_MS;
    this.halfOpenAttempts = 0;
    this.halfOpenSuccesses = 0;
    this.pool = null;
    this.cleanupInterval = null;
    this._startCleanup();
  }

  _startCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.lastAccess > ENTRY_TTL_MS) this.buckets.delete(key);
      }
      if (this.buckets.size > MAX_ENTRIES) {
        const sorted = [...this.buckets.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
        const toRemove = this.buckets.size - MAX_ENTRIES;
        for (let i = 0; i < toRemove; i++) this.buckets.delete(sorted[i][0]);
      }
    }, CLEANUP_INTERVAL_MS);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  destroy() { if (this.cleanupInterval) clearInterval(this.cleanupInterval); }
  setPool(pool) { this.pool = pool; }

  normalizeIP(ip) {
    if (!ip || typeof ip !== 'string') return '0.0.0.0';
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return mapped[1];
    if (ip === '::1') return '127.0.0.1';
    return ip;
  }

  extractIP(req) {
    const cfIP = req.headers && req.headers['cf-connecting-ip'];
    if (cfIP) return this.normalizeIP(cfIP);
    if (req.realIp) return this.normalizeIP(req.realIp);
    return this.normalizeIP(req.socket && req.socket.remoteAddress);
  }

  _getBucket(key, refillPerMin, burst) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, lastRefill: Date.now(), lastAccess: Date.now(), refillPerMs: refillPerMin / 60000, burst: burst };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  _refill(bucket) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + (elapsed * bucket.refillPerMs));
    bucket.lastRefill = now;
    bucket.lastAccess = now;
  }

  checkLimit(key, refillPerMin, burst) {
    const bucket = this._getBucket(key, refillPerMin, burst);
    this._refill(bucket);
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    return { allowed: allowed, remaining: Math.floor(bucket.tokens), resetMs: allowed ? 0 : Math.ceil((1 - bucket.tokens) / bucket.refillPerMs) };
  }

  middleware(options) {
    const opts = options || {};
    const globalRefill = opts.globalRefill || DEFAULT_GLOBAL_REFILL;
    const globalBurst = opts.globalBurst || DEFAULT_GLOBAL_BURST;
    const userRefill = opts.userRefill || DEFAULT_USER_REFILL;
    const userBurst = opts.userBurst || DEFAULT_USER_BURST;

    return (req, res, next) => {
      // NATIVE EXEMPTION: Security routes bypass rate limiting
      for (const exempt of EXEMPT_PATHS) {
        if (req.path && req.path.startsWith(exempt)) return next();
      }

      const circuit = this.checkCircuit();
      if (!circuit.allowed) return res.status(503).json({ error: 'Service temporarily unavailable', reason: 'CIRCUIT_OPEN', retryAfter: circuit.retryAfter });

      const pool = this.checkPoolPressure();
      if (!pool.allowed) return res.status(503).json({ error: 'Service under high load', reason: 'POOL_EXHAUSTED', retryAfter: 5 });

      const ip = this.extractIP(req);
      const userId = (req.authResult && req.authResult.userId) || ip;

      const globalCheck = this.checkLimit('GLOBAL', globalRefill, globalBurst);
      if (!globalCheck.allowed) {
        res.setHeader('Retry-After', Math.ceil(globalCheck.resetMs / 1000));
        return res.status(429).json({ error: 'Too many requests', reason: 'GLOBAL_RATE_LIMIT', retryAfter: Math.ceil(globalCheck.resetMs / 1000) });
      }

      const userCheck = this.checkLimit('USER:' + userId, userRefill, userBurst);
      if (!userCheck.allowed) {
        res.setHeader('Retry-After', Math.ceil(userCheck.resetMs / 1000));
        return res.status(429).json({ error: 'Too many requests', reason: 'USER_RATE_LIMIT', retryAfter: Math.ceil(userCheck.resetMs / 1000) });
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
        return { allowed: false, retryAfter: Math.ceil((this.circuitResetMs - (now - this.circuitLastFailure)) / 1000) };
      }
    }
    if (this.circuitState === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= CIRCUIT_HALF_OPEN_MAX) return { allowed: false, retryAfter: 5 };
      this.halfOpenAttempts++;
    }
    return { allowed: true };
  }

  recordSuccess() {
    if (this.circuitState === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= CIRCUIT_HALF_OPEN_MAX) {
        this.circuitState = 'CLOSED';
        this.circuitFailures = 0;
        this.circuitResetMs = CIRCUIT_BASE_RESET_MS;
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
      this.circuitResetMs = Math.min(CIRCUIT_MAX_RESET_MS, this.circuitResetMs * 2);
    } else if (this.circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitState = 'OPEN';
    }
  }

  checkPoolPressure() {
    if (!this.pool) return { allowed: true, pressure: 0 };
    const total = this.pool.totalCount || 0;
    const idle = this.pool.idleCount || 0;
    if (total === 0) return { allowed: true, pressure: 0 };
    const pressure = (total - idle) / total;
    if (pressure >= POOL_REJECT_THRESHOLD) return { allowed: false, pressure: pressure };
    return { allowed: true, pressure: pressure };
  }

  async safeQueryWithCancellation(queryFn, params, timeoutMs) {
    const timeout = timeoutMs || QUERY_TIMEOUT_MS;
    const circuit = this.checkCircuit();
    if (!circuit.allowed) throw new Error('CIRCUIT_OPEN');
    const pool = this.checkPoolPressure();
    if (!pool.allowed) throw new Error('POOL_EXHAUSTED');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const result = await queryFn(params, controller.signal);
      clearTimeout(timeoutId);
      this.recordSuccess();
      return result;
    } catch (e) {
      clearTimeout(timeoutId);
      this.recordFailure();
      throw e;
    }
  }

  getStatus() {
    return {
      circuit: { state: this.circuitState, failures: this.circuitFailures, resetMs: this.circuitResetMs },
      pool: this.pool ? { total: this.pool.totalCount || 0, idle: this.pool.idleCount || 0 } : null,
      buckets: this.buckets.size
    };
  }
}

const limiter = new SovereignRateLimiter();

export function rateLimitMiddleware(options) { return limiter.middleware(options); }
export function getRateLimiterStatus() { return limiter.getStatus(); }
export function setRateLimiterPool(pool) { limiter.setPool(pool); }
export function safeQueryWithCancellation(queryFn, params, timeoutMs) { return limiter.safeQueryWithCancellation(queryFn, params, timeoutMs); }
export function recordDBSuccess() { limiter.recordSuccess(); }
export function recordDBFailure() { limiter.recordFailure(); }
export function destroyRateLimiter() { limiter.destroy(); }
export default { rateLimitMiddleware, getRateLimiterStatus, setRateLimiterPool, safeQueryWithCancellation, recordDBSuccess, recordDBFailure, destroyRateLimiter };
