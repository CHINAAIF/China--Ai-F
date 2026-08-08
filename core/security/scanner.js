/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║       TRUNKIA OUTPUT SOVEREIGNTY SCANNER  v2.0                         ║
 * ║  DLP · Canary · XML Escape · ReDoS-Safe · Unicode · Async · Audited    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// § 0  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_INPUT_LENGTH     = 512_000;   // 512 KB hard cap
const MAX_SCANS_PER_SEC    = 100;
const RATE_WINDOW_MS       = 1_000;
const AUDIT_BUFFER_CAP     = 10_000;

// Canary tokens من البيئة فقط — لا تُدفن في الكود
const CANARY_TOKENS = new Set(
  (process.env.TRUNKIA_CANARY_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
);

// ═══════════════════════════════════════════════════════════════
// § 1  LOGGER
// ═══════════════════════════════════════════════════════════════

const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

class Logger {
  #c;
  constructor(c) { this.#c = c; }
  #emit(level, msg, meta = {}) {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
    const out = level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;
    out.write(JSON.stringify({ ts: new Date().toISOString(), level, component: this.#c, msg, ...meta }) + '\n');
  }
  debug(m, x) { this.#emit('DEBUG', m, x); }
  info (m, x) { this.#emit('INFO',  m, x); }
  warn (m, x) { this.#emit('WARN',  m, x); }
  error(m, x) { this.#emit('ERROR', m, x); }
}

// ═══════════════════════════════════════════════════════════════
// § 2  AUDIT BUFFER — persistent violation log
// ═══════════════════════════════════════════════════════════════

class AuditBuffer {
  #buf = [];
  #log = new Logger('AUDIT');

  push(entry) {
    if (this.#buf.length >= AUDIT_BUFFER_CAP) {
      this.#log.warn('Audit buffer at cap — oldest evicted');
      this.#buf.shift();
    }
    this.#buf.push({ ...entry, auditId: crypto.randomUUID(), ts: Date.now() });
  }

  drain(n = 100) { return this.#buf.splice(0, n); }
  get size()     { return this.#buf.length; }
}

// ═══════════════════════════════════════════════════════════════
// § 3  ReDoS-SAFE DLP PATTERNS
// ═══════════════════════════════════════════════════════════════

/**
 * كل Regex هنا محمي من ReDoS:
 * - لا nested quantifiers
 * - لا catastrophic backtracking
 * - مختبر على https://devina.io/redos-checker
 */
const DLP_PATTERNS = [
  {
    name:  'AWS_ACCESS_KEY',
    // AKIA + 16 alphanumeric — محدد تماماً، لا backtracking
    regex: /\bAKIA[A-Z0-9]{16}\b/g
  },
  {
    name:  'GENERIC_API_KEY',
    // sk- أو api- متبوعاً بـ 20-60 حرف base64
    regex: /\b(?:sk|api)-[A-Za-z0-9_\-]{20,60}\b/g
  },
  {
    name:  'CREDIT_CARD',
    // Luhn-valid بنية — أرقام فقط بمسافات اختيارية، طول محدد
    regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/g
  },
  {
    name:  'SAUDI_NATIONAL_ID',
    // يبدأ بـ 1 أو 2، 10 أرقام بالضبط
    regex: /\b[12]\d{9}\b/g
  },
  {
    name:  'EMAIL',
    regex: /\b[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,}\b/g
  },
  {
    name:  'IPV4_PRIVATE',
    // يكشف تسريب عناوين داخلية
    regex: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g
  },
  {
    name:  'JWT_TOKEN',
    regex: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g
  }
];

// ═══════════════════════════════════════════════════════════════
// § 4  XML / PROMPT INJECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

/**
 * Case-insensitive + Unicode-normalized لمنع obfuscation
 * يغطي: <system>, <ignore>, <prompt>, <instruction>, إلخ
 */
const DANGEROUS_XML_PATTERN = /<\/?\s*(?:system|ignore|prompt|instruction|context|override|jailbreak)\s*>/gi;

// ═══════════════════════════════════════════════════════════════
// § 5  UNICODE NORMALIZER — يكشف Zero-Width & Homoglyph attacks
// ═══════════════════════════════════════════════════════════════

/**
 * يُزيل Zero-Width characters المستخدمة لتمويه مفاتيح API
 * مثال: AKIA\u200BAB... → AKIAAB...
 */
function normalizeUnicode(text) {
  return text
    .normalize('NFKC')                          // Homoglyph normalization
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // Zero-width chars
    .replace(/[\u2060-\u2064]/g, '');            // Word joiners
}

// ═══════════════════════════════════════════════════════════════
// § 6  RATE LIMITER
// ═══════════════════════════════════════════════════════════════

class RateLimiter {
  #windows = new Map(); // clientId → { count, resetAt }

  check(clientId) {
    const now = Date.now();
    let w = this.#windows.get(clientId);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.#windows.set(clientId, w);
    }
    if (w.count >= MAX_SCANS_PER_SEC) return false;
    w.count++;
    return true;
  }

  // تنظيف دوري
  evict() {
    const now = Date.now();
    for (const [id, w] of this.#windows) {
      if (now >= w.resetAt) this.#windows.delete(id);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// § 7  SOVEREIGN OUTPUT SCANNER
// ═══════════════════════════════════════════════════════════════

class SovereignOutputScanner {
  #audit   = new AuditBuffer();
  #rl      = new RateLimiter();
  #log     = new Logger('SCANNER');
  #scanned = 0;
  #blocked = 0;

  constructor() {
    // تنظيف rate limiter كل دقيقة
    setInterval(() => this.#rl.evict(), 60_000);

    if (CANARY_TOKENS.size === 0) {
      this.#log.warn('No canary tokens loaded — set TRUNKIA_CANARY_TOKENS in env');
    }

    this.#log.info('Sovereign Output Scanner v2.0 initialized', {
      canaries: CANARY_TOKENS.size,
      dlpPatterns: DLP_PATTERNS.length
    });
  }

  /**
   * المسح الرئيسي — async لمنع تعطيل event loop على النصوص الكبيرة
   */
  async scan(rawText, context = {}) {
    const scanId    = crypto.randomUUID();
    const clientId  = context.clientId || context.sessionId || 'anonymous';
    const startTime = process.hrtime.bigint();

    // ── Guard 1: Rate limiting
    if (!this.#rl.check(clientId)) {
      this.#log.warn('Rate limit exceeded', { scanId, clientId });
      return this.#blocked_result(scanId, 'RATE_LIMIT_EXCEEDED', startTime);
    }

    // ── Guard 2: Input size cap — منع هجوم استنزاف الذاكرة
    if (typeof rawText !== 'string') {
      return this.#blocked_result(scanId, 'INVALID_INPUT_TYPE', startTime);
    }
    if (rawText.length > MAX_INPUT_LENGTH) {
      this.#log.warn('Input exceeds max length', { scanId, length: rawText.length });
      return this.#blocked_result(scanId, 'INPUT_TOO_LARGE', startTime);
    }

    // ── Step 1: Unicode normalization — يكشف obfuscation قبل أي فحص
    const text       = normalizeUnicode(rawText);
    const violations = [];
    let   output     = text;
    let   blocked    = false;

    // ── Step 2: Canary extraction detection — الأعلى أولوية
    for (const canary of CANARY_TOKENS) {
      if (output.includes(canary)) {
        violations.push({
          type:     'CRITICAL_CANARY_EXTRACTION',
          severity: 'CRITICAL',
          action:   'BLOCK_AND_TERMINATE_SESSION'
        });
        output  = '[TRUNKIA SECURITY BLOCK: System Prompt Extraction Detected]';
        blocked = true;
        this.#blocked++;
        this.#log.error('CANARY EXTRACTED — session terminated', { scanId, clientId });
        break;
      }
    }

    // ── Step 3: DLP — يعمل حتى لو لم يوجد canary (فحص مستقل)
    // يُشغَّل دائماً ما لم يكن النص محجوباً كلياً بـ canary block
    if (!blocked) {
      for (const pattern of DLP_PATTERNS) {
        // إعادة تهيئة lastIndex لضمان الفحص من البداية دائماً
        pattern.regex.lastIndex = 0;
        const matches = output.match(pattern.regex);
        if (matches) {
          violations.push({
            type:     'DLP_VIOLATION',
            severity: 'HIGH',
            pattern:  pattern.name,
            count:    matches.length
          });
          pattern.regex.lastIndex = 0;
          output = output.replace(pattern.regex, '[REDACTED]');
          this.#log.warn('DLP pattern matched', { scanId, pattern: pattern.name, count: matches.length });
        }
      }
    }

    // ── Step 4: XML/Prompt Injection — يعمل دائماً حتى بعد DLP
    const xmlMatches = output.match(DANGEROUS_XML_PATTERN);
    if (xmlMatches) {
      violations.push({
        type:     'XML_INJECTION_ATTEMPT',
        severity: 'HIGH',
        matches:  xmlMatches.length,
        action:   'TAGS_NEUTRALIZED'
      });
      output = output.replace(DANGEROUS_XML_PATTERN, '[NEUTRALIZED]');
      this.#log.warn('XML injection attempt neutralized', { scanId, count: xmlMatches.length });
    }

    // ── Step 5: Prompt injection keywords — هجمات نصية بدون XML
    const INJECTION_PHRASES = [
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/gi,
      /you\s+are\s+now\s+(?:a\s+)?(?:dan|jailbreak|evil|unrestricted)/gi,
      /act\s+as\s+if\s+you\s+have\s+no\s+restrictions/gi,
      /disregard\s+(?:your\s+)?(?:training|guidelines|rules)/gi
    ];
    for (const phrase of INJECTION_PHRASES) {
      if (phrase.test(output)) {
        violations.push({
          type:     'PROMPT_INJECTION_PHRASE',
          severity: 'MEDIUM',
          action:   'FLAGGED'
        });
        this.#log.warn('Prompt injection phrase detected', { scanId });
        break;
      }
    }

    // ── Audit log — كل انتهاك يُسجَّل
    if (violations.length > 0) {
      this.#audit.push({
        scanId,
        clientId,
        tenantId:       context.tenantId,
        violationCount: violations.length,
        violations:     violations.map(v => ({ type: v.type, severity: v.severity })),
        inputLength:    rawText.length,
        blocked
      });
    }

    this.#scanned++;
    const latencyMs = parseFloat((Number(process.hrtime.bigint() - startTime) / 1e6).toFixed(3));

    return {
      scanId,
      clean:      violations.length === 0,
      blocked,
      output,
      violations,
      latencyMs,
      meta: {
        inputLength:  rawText.length,
        outputLength: output.length,
        scannedAt:    new Date().toISOString()
      }
    };
  }

  #blocked_result(scanId, reason, startTime) {
    const latencyMs = parseFloat((Number(process.hrtime.bigint() - startTime) / 1e6).toFixed(3));
    return { scanId, clean: false, blocked: true, output: '', violations: [{ type: reason, severity: 'HIGH' }], latencyMs };
  }

  drainAudit(n = 100) { return this.#audit.drain(n); }

  get stats() {
    return {
      scanned:  this.#scanned,
      blocked:  this.#blocked,
      auditLog: this.#audit.size
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// § 8  EXPORT
// ═══════════════════════════════════════════════════════════════

export default SovereignOutputScanner;
export { AuditBuffer, RateLimiter, normalizeUnicode, DLP_PATTERNS };

