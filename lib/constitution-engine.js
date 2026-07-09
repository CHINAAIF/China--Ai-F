/**
 * TRUNKIA Sovereign Constitution Engine
 * Rigorous mathematical rules using direct references to avoid context issues.
 */
import crypto from 'crypto';

const RULES = {
  CRITICAL_WRITE: {
    tables: ['users', 'api_keys', 'sessions', 'byok_keys', 'governance_audit_chain'],
    check: (intent) => {
      if (!intent.table || !RULES.CRITICAL_WRITE.tables.includes(intent.table)) return true;
      return intent.signature && intent.userId;
    }
  },
  TOKEN_BUDGET: {
    limits: { intelligence: 50000, governance: 10000, analysis: 30000 },
    check: (intent, usage) => {
      const limit = RULES.TOKEN_BUDGET.limits[intent.layer] || 10000;
      return (usage || 0) < limit;
    }
  },
  DATA_ISOLATION: {
    check: (intent) => {
      if (!intent.userId) return false;
      if (intent.targetUserId && intent.targetUserId !== intent.userId) return false;
      return true;
    }
  },
  CONSENSUS_REQUIRED: {
    actions: ['delete_agent', 'modify_constitution', 'reset_circuit', 'execute_sql_write'],
    check: (intent) => {
      if (!RULES.CONSENSUS_REQUIRED.actions.includes(intent.action)) return true;
      return intent.signatures && intent.signatures.length >= 2;
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
        const passed = rule.check(intent, intent.usage || 0);
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
    console.error(`[CONSTITUTION] VIOLATION by ${intent.agentName}:`, violations.map(v => v.rule).join(', '));
    
    return { allowed: false, violations, constitutionalHash, evaluatedAt: Date.now() };
  }

  getStats() {
    return {
      total_checks: this.checksRun,
      passed: this.checksPassed,
      violations: this.violations.length
    };
  }
}

export const constitutionEngine = new ConstitutionEngine();
