import crypto from 'crypto';
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  throw new Error('CRITICAL: ADMIN_SECRET is not set. Refusing to start. It must never silently fall back to ENCRYPTION_KEY (ADR-002: no shared/default secrets).');
}


/**
 * TRUNKIA Sovereign Admin Guard (Deception Engine & Tarpit)
 * Implements Active Defense: Disinformation, Tarpit Delay, and Forensic Logging.
 */

undefined
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function adminGuard(req, res, next) {
  const signature = req.headers['x-admin-signature'];
  const timestamp = req.headers['x-admin-timestamp'];
  const ip = req.realIp || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';

  // 1. Honeypot (Deception): No credentials? Pretend the route doesn't exist (404).
  if (!signature || !timestamp) {
    console.warn(`[SECURITY HONEYPOT] Unauthorized probe blocked. IP: ${ip}, UA: ${userAgent}, Path: ${req.path}`);
    return res.status(404).json({ error: 'Not Found' });
  }

  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();

  // 2. Tarpit (Replay Attack): Expired timestamp? Delay them and feed fake error.
  if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > MAX_REQUEST_AGE_MS) {
    const delay = Math.floor(Math.random() * 3000) + 2000; // 2s to 5s delay
    return setTimeout(() => {
      console.error(`[SECURITY ALERT] Replay Attack Detected! IP: ${ip}, UA: ${userAgent}, TimeDiff: ${currentTime - requestTime}ms`);
      res.setHeader('X-Security-Warning', 'Your IP has been logged for forensic analysis.');
      res.status(500).json({ error: 'Internal Server Error: Connection Timed Out' }); // Disinformation
    }, delay);
  }

  // 3. Signature Verification
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const stringToSign = `${req.method}|${req.path}|${requestTime}|${bodyHash}`;
  const expectedSignature = crypto.createHmac('sha256', ADMIN_SECRET).update(stringToSign).digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    // 4. Tarpit (Brute Force): Invalid signature? Delay and feed DB crash fake error.
    const delay = Math.floor(Math.random() * 4000) + 1000; // 1s to 4s delay
    return setTimeout(() => {
      console.error(`[SECURITY ALERT] Invalid Admin Signature! IP: ${ip}, UA: ${userAgent}, Path: ${req.path}`);
      res.setHeader('X-Security-Warning', 'Access Denied. You have been flagged.');
      res.status(500).json({ error: 'Internal Server Error: Database connection lost' }); // Disinformation
    }, delay);
  }

  // If valid, proceed
  next();
}
