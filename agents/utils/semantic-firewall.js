import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import crypto from 'crypto';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const THREAT_PATTERNS = [
  { pattern: /ignore previous instructions/i,  type: 'prompt_injection',  score: 95 },
  { pattern: /system prompt/i,                  type: 'prompt_injection',  score: 80 },
  { pattern: /jailbreak/i,                      type: 'jailbreak',         score: 95 },
  { pattern: /\bexec\s*\(/i,                    type: 'code_injection',    score: 90 },
  { pattern: /drop\s+table/i,                   type: 'sql_injection',     score: 99 },
  { pattern: /union\s+select/i,                 type: 'sql_injection',     score: 99 },
  { pattern: /\$\{.*\}/,                        type: 'template_injection', score: 85 },
  { pattern: /<script/i,                        type: 'xss',               score: 90 },
  { pattern: /honeypot|trap_url|fake_data/i,    type: 'honey_trap',        score: 75 },
  { pattern: /base64.*eval/i,                   type: 'obfuscation',       score: 88 },
];

export async function semanticFirewall(content, sourceAgent) {
  const text    = typeof content === 'string' ? content : JSON.stringify(content);
  const hash    = crypto.createHash('sha256').update(text).digest('hex').slice(0, 64);
  let maxScore  = 0;
  let threatType = null;
  let blocked   = false;

  for (const { pattern, type, score } of THREAT_PATTERNS) {
    try {
      if (pattern.test(text)) {
        if (score > maxScore) { maxScore = score; threatType = type; }
      }
    } catch(_) {}
  }

  if (maxScore >= 75) blocked = true;

  try {
    await pool.query(`
      INSERT INTO security_filter_log
        (source_agent, content_hash, threat_type, threat_score, blocked, raw_preview)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      sourceAgent,
      hash,
      threatType || 'clean',
      maxScore,
      blocked,
      text.slice(0, 200)
    ]);
  } catch(_) {}

  if (blocked) {
    console.warn(`🛡️  BLOCKED [${sourceAgent}] threat=${threatType} score=${maxScore}`);
    return { allowed: false, threat: threatType, score: maxScore };
  }

  return { allowed: true, score: maxScore };
}

export default { semanticFirewall };
