import crypto from 'crypto';

// ── Request ID — كل طلب له معرف فريد ───────────────────────────
export function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

// ── API Version Header ───────────────────────────────────────────
export function apiVersion(req, res, next) {
  res.setHeader('X-API-Version', 'v1');
  res.setHeader('X-Powered-By', 'TRUNKIA');
  next();
}

// ── Request Logger ───────────────────────────────────────────────
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 2000) console.warn(`⚠️  SLOW [${req.requestId}] ${req.method} ${req.path} — ${ms}ms`);
  });
  next();
}

export default { requestId, apiVersion, requestLogger };
