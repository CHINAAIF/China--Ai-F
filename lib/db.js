import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('CRITICAL: DATABASE_URL is not set. Refusing to start.');
}

const isProduction = process.env.NODE_ENV === 'production';
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

const pools = {};

/**
 * يوفر تجمع اتصال مركزي (Singleton) لكل قاعدة بيانات.
 * هذا يمنع الوكلاء من فتح تجمعات منفصلة ويحمي النظام من استنزاف الاتصالات.
 */
export function getPool(name = 'main') {
  if (pools[name]) return pools[name];

  let url;
  if (name === 'main') url = process.env.DATABASE_URL;
  else if (name === 'governance') url = process.env.DATABASE_URL_GOVERNANCE;
  else if (name === 'intelligence') url = process.env.DATABASE_URL_INTELLIGENCE;
  else if (name === 'security') url = process.env.DATABASE_URL_SECURITY;
  else if (name === 'learning') url = process.env.DATABASE_URL_LEARNING;
  else throw new Error(`Unknown DB pool requested: ${name}`);

  if (!url) throw new Error(`Database URL for ${name} is not set in environment.`);

  console.log(`[DB] Initializing central pool for: ${name}`);
  pools[name] = new pg.Pool({
    connectionString: url,
    ssl: sslConfig,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 30000,
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

// Default pool (for backward compatibility with existing code that imports `pool`)
export const pool = getPool('main');

export async function query(text, params) {
  const start = Date.now();
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
