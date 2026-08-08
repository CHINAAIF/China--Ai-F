/**
 * TRUNKIA Sovereign Constitution Engine v2.0
 * Implements Intent Isolation & Taint Tracking (Data/Instruction Separation).
 */
import crypto from 'crypto';

const RULES = {
  // قاعدة 1: البيانات الملوثة لا يمكن أن تصبح تعليمات تنفيذية
  TAINT_TRACKING: {
    check: (intent) => {
      // إذا كان الفعل يتطلب صلاحية تنفيذية (كتابة، حذف، أمر نظام)
      if (intent.action === 'execute_sql_write' || intent.action === 'system_command') {
        // يجب أن يكون مصدر النية هو النظام نفسه، وليس المستخدم أو الـ LLM
        if (intent.origin !== 'system') {
          return false; // BLOCKED: Tainted data attempting execution
        }
      }
      return true;
    }
  },
  // قاعدة 2: التوقيع التشفيري للإجراءات الحرجة
  CRITICAL_WRITE: {
    tables: ['users', 'api_keys', 'sessions', 'byok_keys', 'governance_audit_chain'],
    check: (intent) => {
      if (!intent.table || !RULES.CRITICAL_WRITE.tables.includes(intent.table)) return true;
      return intent.signature && intent.userId;
    }
  },
  // قاعدة 3: عزل البيانات (Zero-Trust Data Access)
  DATA_ISOLATION: {
    check: (intent) => {
      if (!intent.userId) return false;
      if (intent.targetUserId && intent.targetUserId !== intent.userId) return false;
      return true;
    }
  }
};

class ConstitutionEngine {
  constructor() {
    this.violations = [];
    this.checksRun = 0;
    this.checksPassed = 0;
  }

  evaluate(intent) {
    this.checksRun++;
    const violations = [];
    
    for (const [name, rule] of Object.entries(RULES)) {
      try {
        const passed = rule.check(intent);
        if (!passed) {
          violations.push({ rule: name, severity: 'CRITICAL', agent: intent.agentName });
        }
      } catch (e) {
        violations.push({ rule: name, severity: 'CRITICAL', agent: intent.agentName });
      }
    }
    
    const decisionPayload = JSON.stringify({ intent, violations, timestamp: Date.now() });
    const constitutionalHash = crypto.createHash('sha256').update(decisionPayload).digest('hex');
    
    if (violations.length === 0) {
      this.checksPassed++;
      return { allowed: true, violations: [], constitutionalHash, evaluatedAt: Date.now() };
    }
    
    this.violations.push(...violations);
    console.error(`[CONSTITUTION] VIOLATION by ${intent.agentName} (Origin: ${intent.origin}):`, violations.map(v => v.rule).join(', '));
    
    return { allowed: false, violations, constitutionalHash, evaluatedAt: Date.now() };
  }
}

export const constitutionEngine = new ConstitutionEngine();
