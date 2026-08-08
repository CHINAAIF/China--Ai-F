import fs from 'fs';
const f = 'agents/learning/truth-tribunal-agent.js';
let c = fs.readFileSync(f, 'utf8');

// Replace the main try-catch block to handle DB timeouts gracefully
const oldCatch = `    } catch (e) {
      console.error('[TruthTribunal] Error:', e.message);
      return { success: false, error: e.message };
    }`;

const newCatch = `    } catch (e) {
      if (e.message.includes('timeout') || e.message.includes('Connection terminated')) {
        console.warn('[TruthTribunal] DB Unreachable. Entering Graceful Degradation.');
        return { success: true, status: 'degraded', message: 'Database is currently unreachable. Tribunal paused.' };
      }
      console.error('[TruthTribunal] Error:', e.message);
      return { success: false, error: e.message };
    }`;

if (c.includes(oldCatch)) {
  c = c.replace(oldCatch, newCatch);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched truth-tribunal-agent.js (Graceful Degradation applied)');
} else {
  console.error('❌ FAIL: Could not find the catch block.');
}
