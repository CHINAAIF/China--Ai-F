import { Pool as PgPool } from '@neondatabase/serverless';
import crypto from 'crypto';
import dns from 'dns';

// Force IPv4 to bypass Termux/Carrier IPv6 routing issues
dns.setDefaultResultOrder('ipv4first');

// --- SOVEREIGN APPLICATION-LEVEL VETO ---
const PROTECTED_TABLES = ['immune_audit_chain', 'event_log', 'agent_execution_logs', 'governance_audit_chain', 'intel_provenance_chain', 'evidence_chain', 'immune_agent_trust', 'agent_behavioral_baselines', 'immune_anomaly_log', 'canary_token_registry'];

function enforceSovereignVeto(text) {
  if (!text || typeof text !== 'string') return;
  
  // Check if emergency override is active (Requires both env var and HMAC signature)
  const overrideSig = process.env.APP_EMERGENCY_OVERRIDE_SIG;
  const expectedSig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update('EMERGENCY_OVERRIDE').digest('hex');
  const isEmergencyActive = overrideSig === expectedSig;

  if (isEmergencyActive) return; // Allow if break-glass is explicitly activated

  const upperText = text.toUpperCase();
  for (const table of PROTECTED_TABLES) {
    const tableUpper = table.toUpperCase();
    // Detect UPDATE or DELETE on protected tables
    if ((upperText.includes('UPDATE ' + tableUpper) || upperText.includes('DELETE FROM ' + tableUpper)) && !upperText.includes('WHERE 1=0')) {
      throw new Error('SOVEREIGN VETO: Application-level block on protected table ' + table + '. Tampering is forbidden.');
    }
  }
}
// -----------------------------------------


function sanitizeDbUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('postgres')) {
    throw new Error('CRITICAL: Database URL format is invalid.');
  }
  const [base, qs] = url.split('?');
  if (!qs) return url;
  // Remove channel_binding which causes silent hangs in Node.js
  const filtered = qs.split('&').filter(p => !p.startsWith('channel_binding=')).join('&');
  return filtered ? `${base}?${filtered}` : base;
}

if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not set. Refusing to start.');
}

const sslConfig = { rejectUnauthorized: false };
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
  
  // Using Neon Serverless Driver (Port 443 Bypass)
  pools[name] = new PgPool({
    connectionString: sanitizeDbUrl(url),
    ssl: sslConfig,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: false,
  });

  pools[name].on('error', (err) => {
    console.error(`[db:${name}] Pool error:`, err.message);
  });

  return pools[name];
}

const _internalToken = generateDbToken('lib/db.js');

export async function query(text, params) {
  enforceSovereignVeto(text);
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
  const wrappedClient = {
    query: async (text, params) => {
      enforceSovereignVeto(text);
      return client.query(text, params);
    }
  };
  try {
    await client.query('BEGIN');
    const result = await fn(wrappedClient);
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
