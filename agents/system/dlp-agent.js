import { BaseAgent } from '../base-agent.js';
import { dlpEngine } from '../../lib/dlp-engine.js';
import { writeMemory } from '../../lib/blackboard.js';

/**
 * TRUNKIA Data Leak Preventer Agent
 * Monitors and redacts sensitive data in system outputs.
 */
class DLPAgent extends BaseAgent {
  constructor() {
    super('dlp_agent', 'system');
  }

  /**
   * يفحص محتوى ويستبدل البيانات الحساسة
   * @param {string} content - المحتوى المراد فحصه
   * @param {string} agentName - الوكيل المصدر
   * @param {string} userId - المستخدم
   */
  async scan(content, agentName = 'unknown', userId = 'unknown') {
    const result = dlpEngine.scan(content, agentName, userId);
    
    // إذا وجد تسريب، سجله في الذاكرة المشتركة للتحقيق
    if (result.hadLeaks) {
      await writeMemory('security:dlp_incidents', {
        incidents: result.incidents,
        timestamp: Date.now()
      }, 3600);
    }
    
    return result;
  }

  async run() {
    // تقرير دوري عن حالة التسريب
    const stats = dlpEngine.getStats();
    return { success: true, stats };
  }
}

export const dlpAgent = new DLPAgent();
export default dlpAgent;
