import { BaseAgent } from '../base-agent.js';
import { semanticCache } from '../../lib/semantic-cache.js';
import { writeMemory } from '../../lib/blackboard.js';

/**
 * TRUNKIA Self-Healer Agent
 * Reads system vitals and takes corrective actions to prevent crashes.
 */
class SelfHealerAgent extends BaseAgent {
  constructor() {
    super('self_healer', 'system');
    this.actionsTaken = 0;
  }

  async run() {
    try {
      // 1. قراءة النبضات من مكتشف الأعطال
      const vitals = await this.recall('system_vitals');

      // إذا لم تكن هناك نبضات أو لم يكن هناك ضغط، لا تفعل شيئاً
      if (!vitals || vitals.stress_score === 0) {
        return { success: true, message: 'System healthy. No action needed.' };
      }

      console.log(`[SelfHealer] Detected stress score: ${vitals.stress_score}. Initiating recovery protocols...`);
      const actions = [];

      // 2. بروتوكول الطوارئ: تسرب الذاكرة أو ضغط الـ RAM
      if (vitals.memory_leak_suspected || vitals.memory_heap_used_mb > 430) {
        console.warn('[SelfHealer] PROTOCOL: Memory flush initiated.');
        // تفريغ الـ Semantic Cache لتحرير الذاكرة فوراً
        semanticCache.flush();
        actions.push('flushed_semantic_cache');
        
        // إجبار Node.js على تشغيل Garbage Collector (إذا كان مفعلاً)
        if (global.gc) {
          global.gc();
          actions.push('forced_gc');
        }
      }

      // 3. بروتوكول الطوارئ: اختناق حلقة الأحداث أو تشبع DB
      if (vitals.event_loop_lag_ms > 80 || vitals.db_pool_saturation > 15) {
        console.warn('[SelfHealer] PROTOCOL: Entering Degraded Mode (Load Shedding).');
        // رفع علم الوضع المتدهور في الذاكرة المشتركة ليقرأه Express
        await writeMemory('system:degraded_mode', { active: true, reason: 'High stress', timestamp: Date.now() }, 120);
        actions.push('enabled_load_shedding');
      }

      // 4. تسجيل الإجراءات
      if (actions.length > 0) {
        this.actionsTaken += actions.length;
        await this.remember('last_heal_actions', { actions, timestamp: Date.now() }, 300);
        console.log(`[SelfHealer] Actions taken: ${actions.join(', ')}`);
      }

      return { success: true, actions_taken: actions };

    } catch (error) {
      console.error('[SelfHealer] Error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export const selfHealerAgent = new SelfHealerAgent();
export default selfHealerAgent;
