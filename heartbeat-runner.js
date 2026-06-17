import dotenv from 'dotenv'; dotenv.config();
import { loadAllAgents } from './agents/registry.js';
import { pingHeartbeat, markMissed, getSystemHealth } from './agents/utils/heartbeat.js';

const INTERVAL_MS = 60 * 1000; // كل دقيقة

async function runHeartbeat() {
  try {
    // 1. تحميل كل الوكلاء
    const { loaded } = await loadAllAgents();

    // 2. ping لكل وكيل
    for(const agent of loaded) {
      try {
        const ok = await agent.instance.initialize?.();
        await pingHeartbeat(agent.name, ok===false?'error':'active', { layer: agent.layer });
      } catch(e) {
        await pingHeartbeat(agent.name, 'error', { error: e.message.slice(0,100) });
      }
    }

    // 3. تحديث المفقودين
    await markMissed();

    // 4. صحة النظام
    const health = await getSystemHealth();
    console.log(`[${new Date().toISOString()}] ❤️ heartbeat: active=${health.active} warning=${health.warning} dead=${health.dead}/${health.total}`);

    // 5. تنبيه إذا dead>5
    if(health.dead > 5) {
      console.warn(`⚠️ ALERT: ${health.dead} agents dead — diagnostic required`);
    }
  } catch(e) { console.error('heartbeat_runner error:', e.message); }
}

// تشغيل فوري ثم كل دقيقة
runHeartbeat();
setInterval(runHeartbeat, INTERVAL_MS);
console.log('❤️ heartbeat-runner started — every 60s');
