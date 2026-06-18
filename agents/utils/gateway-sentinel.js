import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const AGENT_SECRET  = process.env.ENCRYPTION_KEY || 'chinaaif-sovereign-secret';
const TOKEN_TTL_MS  = 5000; // 5 ثوانٍ فقط
const usedTokens    = new Map(); // منع إعادة الاستخدام

// ── تنظيف التوكنز المنتهية كل دقيقة ────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [token, ts] of usedTokens) {
    if (now - ts > TOKEN_TTL_MS * 2) usedTokens.delete(token);
  }
}, 60000);

// ── توليد HMAC Token لحظي ────────────────────────────────────────
export function generateAgentToken(agentName) {
  const timestamp = Date.now();
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${agentName}:${process.pid}:${process.env.DATABASE_URL?.slice(-8)}`)
    .digest('hex')
    .slice(0, 16);

  const payload = `${agentName}:${timestamp}:${fingerprint}`;
  const hmac = crypto
    .createHmac('sha256', AGENT_SECRET)
    .update(payload)
    .digest('hex');

  return `${Buffer.from(payload).toString('base64')}.${hmac}`;
}

// ── التحقق من Token ──────────────────────────────────────────────
export function verifyAgentToken(token, agentName) {
  try {
    const [payloadB64, hmac] = token.split('.');
    if (!payloadB64 || !hmac) return { valid: false, reason: 'malformed' };

    const payload  = Buffer.from(payloadB64, 'base64').toString();
    const [name, timestamp, fingerprint] = payload.split(':');

    // فحص الهوية
    if (name !== agentName) return { valid: false, reason: 'identity_mismatch' };

    // فحص TTL
    const age = Date.now() - parseInt(timestamp);
    if (age > TOKEN_TTL_MS) return { valid: false, reason: `expired_${age}ms` };

    // فحص إعادة الاستخدام
    if (usedTokens.has(hmac)) return { valid: false, reason: 'replay_attack' };

    // فحص HMAC
    const expected = crypto
      .createHmac('sha256', AGENT_SECRET)
      .update(payload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
      return { valid: false, reason: 'invalid_signature' };
    }

    // تسجيل التوكن كمستخدم
    usedTokens.set(hmac, Date.now());
    return { valid: true, agent: name, age_ms: age };

  } catch(e) {
    return { valid: false, reason: e.message };
  }
}

// ── Fast-Path: Cache أولاً بدون blocking ────────────────────────
export async function fastPath(queryHash, agentName, token) {
  // تحقق HMAC
  const auth = verifyAgentToken(token, agentName);
  if (!auth.valid) {
    await pool.query(`
      INSERT INTO security_filter_log
        (source_agent, threat_type, threat_score, blocked, raw_preview)
      VALUES ($1,'hmac_violation',99,true,$2)
    `, [agentName, auth.reason]).catch(()=>{});

    console.error(`🚨 SENTINEL BLOCKED [${agentName}]: ${auth.reason}`);
    return { allowed: false, reason: auth.reason };
  }

  // Fast-Path Cache Check
  try {
    const { rows } = await pool.query(`
      SELECT response_data, confidence
      FROM sovereign_memory_local
      WHERE query_hash=$1
        AND verified=true
        AND confidence>=80
        AND (valid_until IS NULL OR valid_until > NOW())
      LIMIT 1
    `, [queryHash]);

    if (rows.length > 0) {
      await pool.query(`
        UPDATE sovereign_memory_local
        SET usage_count=usage_count+1, last_used=NOW()
        WHERE query_hash=$1
      `, [queryHash]).catch(()=>{});

      return {
        allowed:   true,
        cache_hit: true,
        data:      rows[0].response_data,
        latency:   'fast_path'
      };
    }
  } catch(_) {}

  return { allowed: true, cache_hit: false };
}

// ── Background Validator — يعمل بالتوازي بدون blocking ──────────
export function backgroundValidate(agentName, queryHash, executionFn) {
  // fire-and-forget — لا ينتظر
  Promise.resolve().then(async () => {
    try {
      await executionFn();
    } catch(e) {
      console.warn(`⚠️  background validation failed [${agentName}]: ${e.message}`);
      await pool.query(`
        INSERT INTO diagnostic_repairs
          (component, issue_type, description, auto_repaired, created_at)
        VALUES ($1,'background_fail',$2,false,NOW())
      `, [agentName, e.message]).catch(()=>{});
    }
  });
}

// ── Cache Revalidation — TTL Decay ───────────────────────────────
export async function runCacheRevalidation() {
  try {
    // حذف المنتهية الصلاحية
    const { rowCount: expired } = await pool.query(`
      DELETE FROM sovereign_memory_local
      WHERE valid_until < NOW()
    `);

    // تطبيق Confidence Decay على القديمة
    const { rowCount: decayed } = await pool.query(`
      UPDATE sovereign_memory_local
      SET confidence = GREATEST(0, confidence - decay_rate),
          valid_until = CASE
            WHEN confidence - decay_rate <= 0 THEN NOW()
            ELSE valid_until
          END
      WHERE last_used < NOW() - INTERVAL '24 hours'
        AND confidence > 0
    `);

    // حذف الثقة الصفرية
    const { rowCount: purged } = await pool.query(`
      DELETE FROM sovereign_memory_local WHERE confidence <= 0
    `);

    console.log(`🔄 Cache revalidation: expired=${expired} decayed=${decayed} purged=${purged}`);

    await pool.query(`
      INSERT INTO diagnostic_repairs
        (component, issue_type, description, auto_repaired, created_at)
      VALUES ('cache-revalidator','scheduled_cleanup',$1,true,NOW())
    `, [`expired=${expired} decayed=${decayed} purged=${purged}`]).catch(()=>{});

  } catch(e) {
    console.warn('revalidation error:', e.message);
  }
}

export default { generateAgentToken, verifyAgentToken, fastPath, backgroundValidate, runCacheRevalidation };
