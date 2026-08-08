/**
 * TRUNKIA Data Loss Prevention (DLP) Engine
 * Scans outputs for sensitive data and redacts them before reaching the user.
 */

// أنماط البيانات الحساسة (Regex Patterns)
const SENSITIVE_PATTERNS = [
  // API Keys (OpenAI, AWS, Groq, GitHub)
  { name: 'API_KEY', pattern: /(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|gsk_[a-zA-Z0-9]{20,})/g, severity: 'CRITICAL' },
  
  // Database Connection Strings
  { name: 'DB_CONNECTION', pattern: /(postgres(?:ql)?:\/\/[^\s"']+)/gi, severity: 'CRITICAL' },
  
  // JWT Tokens
  { name: 'JWT_TOKEN', pattern: /(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g, severity: 'CRITICAL' },
  
  // Credit Card Numbers (basic pattern)
  { name: 'CREDIT_CARD', pattern: /\b(?:\d[ -]*?){13,16}\b/g, severity: 'HIGH' },
  
  // Email addresses (in responses that shouldn't contain them)
  { name: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, severity: 'MEDIUM' },
  
  // Private IP addresses
  { name: 'PRIVATE_IP', pattern: /\b(?:10|127|172\.(?:1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}\b/g, severity: 'MEDIUM' },
  
  // Phone numbers (international format)
  { name: 'PHONE', pattern: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g, severity: 'LOW' },
  
  // Environment variable secrets
  { name: 'ENV_SECRET', pattern: /(?:PASSWORD|SECRET|KEY|TOKEN)\s*[=:]\s*["']?[a-zA-Z0-9_\-]{8,}["']?/gi, severity: 'CRITICAL' }
];

class DLPEngine {
  constructor() {
    this.scanCount = 0;
    this.redactionCount = 0;
    this.incidents = [];
  }

  /**
   * يفحص النص ويستبدل البيانات الحساسة بـ [REDACTED]
   * @param {string} content - النص المراد فحصه
   * @param {string} agentName - اسم الوكيل الذي أنتج النص
   * @param {string} userId - معرف المستخدم
   * @returns {Object} { sanitizedContent, incidents, hadLeaks }
   */
  scan(content, agentName = 'unknown', userId = 'unknown') {
    this.scanCount++;
    
    if (!content || typeof content !== 'string') {
      return { sanitizedContent: content, incidents: [], hadLeaks: false };
    }

    let sanitizedContent = content;
    const incidents = [];

    for (const { name, pattern, severity } of SENSITIVE_PATTERNS) {
      const matches = [...content.matchAll(pattern)];
      
      if (matches.length > 0) {
        // استبدال البيانات الحساسة بـ [REDACTED]
        sanitizedContent = sanitizedContent.replace(pattern, `[REDACTED:${name}]`);
        
        for (const match of matches) {
          const incident = {
            type: name,
            severity,
            agent: agentName,
            userId,
            snippet: match[0].substring(0, 20) + '...',
            timestamp: Date.now()
          };
          incidents.push(incident);
          this.incidents.push(incident);
          this.redactionCount++;
          
          if (severity === 'CRITICAL') {
            console.error(`[DLP CRITICAL] ${name} leaked by ${agentName}. Redacted.`);
          }
        }
      }
    }

    return {
      sanitizedContent,
      incidents,
      hadLeaks: incidents.length > 0
    };
  }

  getStats() {
    return {
      total_scans: this.scanCount,
      total_redactions: this.redactionCount,
      critical_incidents: this.incidents.filter(i => i.severity === 'CRITICAL').length,
      recent_incidents: this.incidents.slice(-10)
    };
  }
}

export const dlpEngine = new DLPEngine();
export default dlpEngine;
