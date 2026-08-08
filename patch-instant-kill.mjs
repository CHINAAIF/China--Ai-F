import fs from 'fs';
const f = 'agents/base-agent.js';
let c = fs.readFileSync(f, 'utf8');

// Replace the blocking triggerApoptosis with a non-blocking version
const oldFunc = `  // Protected method: Requires system key to prevent Cyber Assassination
  async triggerApoptosis(reason, executionKey = null) {
    if (this.isTerminated) return;
    
    // Security: Only allow self-termination or system-authorized termination
    const sysKey = process.env.SYSTEM_EXECUTION_KEY;
    if (sysKey && executionKey !== sysKey) {
      console.error(\`[APOPTOSIS] REJECTED: Unauthorized termination attempt on \${this.name}.\`);
      return;
    }

    this.status = 'appealing'; // Appeal Window (500ms)
    console.warn(\`[APOPTOSIS] Agent \${this.name} appealing. Reason: \${reason}\`);

    // Magical Touch: Appeal Window (Allows async cleanup or override)
    await new Promise(resolve => setTimeout(resolve, 500));

    this.isTerminated = true;
    this.status = 'terminated';

    try {
      // 1. Wipe local memory (Lazy Destruct)
      await writeMemory(\`agent:\${this.name}\`, { status: 'terminated', reason }, 1);
      
      // 2. Broadcast death to other agents (Death Broadcast)
      await writeMemory('system:agent_died', { agent: this.name, timestamp: Date.now() }, 10);
      
      // 3. Record in Immutable Audit Chain (Forensic Proof)
      await recordAuditEvent('agent_apoptosis', this.name, 'self_terminated', { reason });
    } catch (e) {
      console.error(\`[APOPTOSIS] Error during \${this.name} cleanup: \${e.message}\`);
    }
  }`;

const newFunc = `  // Protected method: Requires system key to prevent Cyber Assassination
  async triggerApoptosis(reason, executionKey = null) {
    if (this.isTerminated) return;
    
    const sysKey = process.env.SYSTEM_EXECUTION_KEY;
    if (sysKey && executionKey !== sysKey) {
      console.error(\`[APOPTOSIS] REJECTED: Unauthorized termination attempt on \${this.name}.\`);
      return;
    }

    // Instant Local Death (Non-Blocking)
    this.isTerminated = true;
    this.status = 'terminated';
    console.warn(\`[APOPTOSIS] Agent \${this.name} terminated instantly. Reason: \${reason}\`);

    // Fire-and-Forget Cleanup (Does not block Event Loop)
    setImmediate(async () => {
      try {
        await writeMemory(\`agent:\${this.name}\`, { status: 'terminated', reason }, 1);
        await writeMemory('system:agent_died', { agent: this.name, timestamp: Date.now() }, 10);
        await recordAuditEvent('agent_apoptosis', this.name, 'self_terminated', { reason });
      } catch (e) {
        console.error(\`[APOPTOSIS] Background cleanup failed for \${this.name}: \${e.message}\`);
      }
    });
  }`;

if (c.includes(oldFunc)) {
  c = c.replace(oldFunc, newFunc);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched base-agent.js (Instant Non-Blocking Apoptosis)');
} else {
  console.error('❌ FAIL: Could not find the blocking triggerApoptosis function.');
}
