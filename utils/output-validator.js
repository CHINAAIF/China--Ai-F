
/**
 * TRUNKIA Output Validator
 * Security Layer — يفحص كل رد من Groq قبل إدخاله للـDB
 * يمنع SQL Injection, XSS, وبيانات ضارة
 */

// أنماط خطيرة يجب حظرها
const DANGEROUS_PATTERNS = [
  /\$\{.*\}/g,                    // Template injection
  /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC)\b/gi, // SQL keywords
  /<script[^>]*>.*?<\/script>/gi,   // XSS scripts
  /javascript:/gi,                   // JS protocol
  /on\w+\s*=/gi,                   // Event handlers
  /\b(eval|Function|setTimeout|setInterval)\b\s*\(/g, // Code execution
  /\\x[0-9a-f]{2}/gi,             // Hex encoding
  /\\u[0-9a-f]{4}/gi,             // Unicode escapes
  /\b(require|import)\s*\(/g,     // Module loading
];

// أنماط يجب تنظيفها (ليس حظر)
const SANITIZE_PATTERNS = [
  { pattern: /\n{3,}/g, replacement: '\n\n' },  // Multiple newlines
  { pattern: /\s{2,}/g, replacement: ' ' },         // Multiple spaces
  { pattern: /^\s+|\s+$/gm, replacement: '' },     // Trim lines
];

class OutputValidator {
  constructor() {
    this.validationErrors = [];
    this.sanitizedCount = 0;
  }

  /**
   * التحقق الرئيسي — يُستدعى قبل أي DB insert
   * @param {*} input — البيانات من Groq
   * @param {string} context — سياق الاستخدام (مثلاً: 'intelligence_verified')
   * @returns {{ valid: boolean, data: *, errors: string[], sanitized: boolean }}
   */
  validate(input, context = 'unknown') {
    this.validationErrors = [];
    this.sanitizedCount = 0;
    
    // 1. تحقق من النوع
    if (input === null || input === undefined) {
      return { valid: false, data: null, errors: ['NULL_INPUT'], sanitized: false };
    }

    // 2. إذا كان نصاً
    if (typeof input === 'string') {
      return this._validateString(input, context);
    }

    // 3. إذا كان كائناً
    if (typeof input === 'object') {
      return this._validateObject(input, context);
    }

    // 4. أنواع أخرى (أرقام، booleans)
    return { valid: true, data: input, errors: [], sanitized: false };
  }

  _validateString(str, context) {
    let result = str;
    let sanitized = false;

    // فحص الأنماط الخطيرة
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(result)) {
        this.validationErrors.push('DANGEROUS_PATTERN: ' + pattern.source);
        // لا نرفض، بل ننظف
        result = result.replace(pattern, '[REDACTED]');
        sanitized = true;
      }
    }

    // فحص الطول
    if (result.length > 100000) {
      this.validationErrors.push('STRING_TOO_LONG: ' + result.length);
      result = result.substring(0, 100000);
      sanitized = true;
    }

    // فحص المحتوى الفارغ
    if (result.trim().length < 1) {
      return { valid: false, data: null, errors: ['EMPTY_STRING'], sanitized: false };
    }

    // تنظيف
    for (const { pattern, replacement } of SANITIZE_PATTERNS) {
      const before = result;
      result = result.replace(pattern, replacement);
      if (before !== result) this.sanitizedCount++;
    }

    return { 
      valid: this.validationErrors.length === 0, 
      data: result, 
      errors: [...this.validationErrors], 
      sanitized: sanitized || this.sanitizedCount > 0 
    };
  }

  _validateObject(obj, context, depth = 0) {
    // منع recursion عميق
    if (depth > 10) {
      return { valid: false, data: null, errors: ['MAX_DEPTH_EXCEEDED'], sanitized: false };
    }

    if (Array.isArray(obj)) {
      const results = obj.map(item => this._validateObject(item, context, depth + 1));
      const errors = results.flatMap(r => r.errors);
      const hasInvalid = results.some(r => !r.valid);
      return {
        valid: hasInvalid ? false : errors.length === 0,
        data: results.map(r => r.data),
        errors,
        sanitized: results.some(r => r.sanitized)
      };
    }

    const result = {};
    let hasErrors = false;
    let wasSanitized = false;

    for (const [key, value] of Object.entries(obj)) {
      // فحص المفاتيح
      const keyValidation = this._validateString(key, context + '.key');
      if (!keyValidation.valid) {
        this.validationErrors.push('INVALID_KEY: ' + key);
        hasErrors = true;
        continue;
      }

      // فحص القيم
      if (typeof value === 'string') {
        const valResult = this._validateString(value, context + '.' + key);
        result[keyValidation.data] = valResult.data;
        if (valResult.errors.length > 0) hasErrors = true;
        if (valResult.sanitized) wasSanitized = true;
      } else if (typeof value === 'object' && value !== null) {
        const valResult = this._validateObject(value, context + '.' + key, depth + 1);
        result[keyValidation.data] = valResult.data;
        if (valResult.errors.length > 0) hasErrors = true;
        if (valResult.sanitized) wasSanitized = true;
      } else {
        result[keyValidation.data] = value;
      }
    }

    return {
      valid: !hasErrors,
      data: result,
      errors: [...this.validationErrors],
      sanitized: wasSanitized
    };
  }

  /**
   * تحقق سريع — يُستخدم للـlogging (لا يرفض أبداً)
   */
  safeStringify(data, maxLen = 50000) {
    try {
      let str = JSON.stringify(data);
      if (str.length > maxLen) {
        str = str.substring(0, maxLen) + '...[TRUNCATED]';
      }
      return str;
    } catch {
      return '[UNSTRINGIFIABLE]';
    }
  }
}

// Singleton export
const validator = new OutputValidator();
export default validator;
export { OutputValidator };
