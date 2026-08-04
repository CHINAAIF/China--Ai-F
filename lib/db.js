import pg from 'pg';
import crypto from 'crypto';

function sanitizeDbUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('postgres')) {
    throw new Error('CRITICAL: Database URL format is invalid.');
  }
  const [base, qs] = url.split('?');
  if (!qs) return url;
  const filtered = qs.split('&').filter(p => !p.startsWith('channel_binding=')).join('&');
  return filtered ? `${base}?${filtered}` : base;
}

if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not set. Refusing to start.');
}

const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

const pools = {};

export function generateDbToken(callerPath) {
  const secret = process.env.GOVERNANCE_HMAC_SECRET;
  if (!secret) throw new Error('CRITICAL: GOVERNANCE_HMAC_SECRET is missing for DB Lock.');
  const sig = crypto.createHmac('sha256', secret).update(callerPath).digest('hex');
  return `${callerPath}:${sig}`;
}

export function getPool(name = 'main', authToken = null) {
  if (pools[name]) return pools[name];

  const secret = process.env.GOVERNANCE_HMAC_SECRET;
  if (!secret) throw new Error('CRITICAL: GOVERNANCE_HMAC_SECRET is missing. DB Lock active.');
  if (!authToken) throw new Error(`[DB LOCK] Access denied to '${name}' pool: No Auth Token provided.`);

  const [callerPath, signature] = authToken.split(':');
  if (!callerPath || !signature) throw new Error('[DB LOCK] Invalid token format.');

  const expectedSig = crypto.createHmac('sha256', secret).update(callerPath).digest('hex');
  if (signature !== expectedSig) {
    console.error(`[DB LOCK] REJECTED: Invalid signature for ${callerPath}`);
    throw new Error('Access Denied: Cryptographic verification failed.');
  }

  let url;
  if (name === 'main') url = process.env.DATABASE_URL;
  else if (name === 'governance') url = process.env.DATABASE_URL_GOVERNANCE;
  else if (name === 'intelligence') url = process.env.DATABASE_URL_INTELLIGENCE;
  else if (name === 'security') url = process.env.DATABASE_URL_SECURITY;
  else if (name === 'learning') url = process.env.DATABASE_URL_LEARNING;
  else throw new Error(`Unknown DB pool requested: ${name}`);

  if (!url) throw new Error(`Database URL for ${name} is not set in environment.`);

  console.log(`[DB] Initializing central pool for: ${name} (Authorized by: ${callerPath})`);
  pools[name] = new pg.Pool({
    connectionString: sanitizeDbUrl(url),
    ssl: sslConfig,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5000,
    allowExitOnIdle: false,
  });

  pools[name].on('error', (err) => {
    console.error(`[db:${name}] Pool error:`, err.message);
  });

  pools[name].on('connect', () => {
    const max = parseInt(process.env.DB_POOL_MAX || '20', 10);
    if (pools[name].totalCount > max * 0.8) {
      console.warn(`[db:${name}] Pool pressure: ${pools[name].totalCount}/${max} connections`);
    }
  });

  return pools[name];
}

const _internalToken = generateDbToken('lib/db.js');

export async function query(text, params) {
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[db] SLOW QUERY (${duration}ms):`, text.substring(0, 80).replace(/\s+/g, ' '));
    }
    return res;
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[db] SLOW TRANSACTION (${duration}ms)`);
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  for (const name in pools) {
    await pools[name].end();
  }
}
