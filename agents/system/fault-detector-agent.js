import { BaseAgent } from '../base-agent.js';
import { monitorEventLoopDelay } from 'perf_hooks';
import { getPool, generateDbToken } from '../../lib/db.js';
import { writeMemory } from '../../lib/blackboard.js';

/**
 * TRUNKIA Fault Detector Agent
 * Proactively detects system anomalies (Event Loop Lag, Memory Leaks, Pool Saturation)
 * before they cause a crash.
 */
class FaultDetectorAgent extends BaseAgent {
  constructor() {
    super('fault_detector', 'system');
    this.eventLoopMonitor = monitorEventLoopDelay();
    this.eventLoopMonitor.enable();
    this.lastMemoryUsage = 0;
    this.memoryLeakTrend = 0;
  }

  async run() {
    const vitals = {
      timestamp: Date.now(),
      event_loop_lag_ms: 0,
      memory_heap_used_mb: 0,
      memory_leak_suspected: false,
      db_pool_saturation: 0,
      stress_score: 0,
      alerts: []
    };

    // 1. فحص تأخير حلقة الأحداث (Event Loop Lag)
    // نأخذ المتوسط (mean) والحد الأقصى (max) خلال الدقيقة الماضية
    this.eventLoopMonitor.disable(); // Reset for reading
    vitals.event_loop_lag_ms = Math.round(this.eventLoopMonitor.mean / 1000000); // ns to ms
    this.eventLoopMonitor.enable(); // Restart monitoring

    if (vitals.event_loop_lag_ms > 100) {
      vitals.stress_score += 40;
      vitals.alerts.push(`CRITICAL: Event Loop Lag is ${vitals.event_loop_lag_ms}ms (Bottleneck detected).`);
    } else if (vitals.event_loop_lag_ms > 50) {
      vitals.stress_score += 20;
      vitals.alerts.push(`WARNING: Event Loop Lag is ${vitals.event_loop_lag_ms}ms.`);
    }

    // 2. فحص الذاكرة وتسرب الذاكرة (Memory Leak Detection)
    const mem = process.memoryUsage();
    vitals.memory_heap_used_mb = Math.round(mem.heapUsed / 1024 / 1024);
    
    // إذا زادت الذاكرة باستمرار عن 400MB، نشتبه في تسرب
    if (vitals.memory_heap_used_mb > this.lastMemoryUsage && vitals.memory_heap_used_mb > 400) {
      this.memoryLeakTrend++;
    } else {
      this.memoryLeakTrend = Math.max(0, this.memoryLeakTrend - 1);
    }
    this.lastMemoryUsage = vitals.memory_heap_used_mb;

    if (this.memoryLeakTrend > 3) {
      vitals.memory_leak_suspected = true;
      vitals.stress_score += 30;
      vitals.alerts.push(`CRITICAL: Memory Leak Suspected. Heap usage consistently rising (${vitals.memory_heap_used_mb}MB).`);
    }

    if (vitals.memory_heap_used_mb > 450) {
      vitals.stress_score += 20;
      vitals.alerts.push(`WARNING: High Memory Usage (${vitals.memory_heap_used_mb}MB). Approaching OOM limit.`);
    }

    // 3. فحص تشبع تجمع الاتصالات (DB Pool Saturation)
    try {
      const pool = getPool('main', generateDbToken('agents/system/fault-detector-agent.js'));
      // totalCount = idle + waiting
      // إذا كان هناك الكثير من الطلبات المعلقة (waiting)، فهذا يعني أن DB لا يستجيب
      const poolSaturation = pool.totalCount - pool.idleCount;
      vitals.db_pool_saturation = poolSaturation;

      if (poolSaturation > 15) { // If > 15 active connections out of 20
        vitals.stress_score += 30;
        vitals.alerts.push(`CRITICAL: DB Pool Saturation high (${poolSaturation} active connections).`);
      }
    } catch (e) {
      // Pool not initialized yet
    }

    // 4. الحفظ في الذاكرة المشتركة ليراه وكيل الشفاء الذاتي
    if (vitals.stress_score > 0) {
      await writeMemory('system:vitals', vitals, 60); // Save to Global Channel
      console.warn(`[FaultDetector] Stress Score: ${vitals.stress_score}. Alerts: ${vitals.alerts.length}`);
    }

    return vitals;
  }
}

export const faultDetectorAgent = new FaultDetectorAgent();
export default faultDetectorAgent;
