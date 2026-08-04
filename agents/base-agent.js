/**
 * TRUNKIA Standard Agent Base Class (Instant Fortified Apoptosis)
 * Features: Cyber Assassination Prevention, Audit Chain Logging, Death Broadcast, Non-Blocking Instant Kill.
 */
import { writeMemory, readMemory } from '../lib/blackboard.js';
import { safeGroqJSON } from '../lib/services/safe-json.js';
import { recordAuditEvent } from '../lib/immune-system.mjs';

export class BaseAgent {
  constructor(name, layer) {
    if (!name || !layer) throw new Error("Agent must have a name and layer");
    this.name = name;
    this.layer = layer;
    this.status = 'active';
    this.isTerminated = false;
    this.anomalyScore = 0;
    this.memoryToken = generateMemoryToken(this.name);

    // AOP Wrapper: Enforce Apoptosis check on run() even if overridden by subclass
    const originalRun = this.run.bind(this);
    this.run = async (input = {}) => {
      this._checkVitals();
      return originalRun(input);
    };
  }

  _checkVitals() {
    if (this.isTerminated) {
      throw new Error(`[APOPTOSIS] Agent ${this.name} is dead. Execution aborted.`);
    }
  }

  async reportAnomaly(score) {
    if (this.isTerminated) return;
    this.anomalyScore += score;
    if (this.anomalyScore > 10) {
      await this.triggerApoptosis(`Self-reported anomaly (${this.anomalyScore})`, process.env.SYSTEM_EXECUTION_KEY);
    }
  }

  // Protected method: Requires system key to prevent Cyber Assassination
  async triggerApoptosis(reason, executionKey = null) {
    if (this.isTerminated) return;
    
    const sysKey = process.env.SYSTEM_EXECUTION_KEY;
    if (sysKey && executionKey !== sysKey) {
      console.error(`[APOPTOSIS] REJECTED: Unauthorized termination attempt on ${this.name}.`);
      return;
    }

    // Instant Local Death (Non-Blocking)
    this.isTerminated = true;
    this.status = 'terminated';
    console.warn(`[APOPTOSIS] Agent ${this.name} terminated instantly. Reason: ${reason}`);

    // Fire-and-Forget Cleanup (Does not block Event Loop)
    setImmediate(async () => {
      try {
        await writeMemory(`agent:${this.name}`, { status: 'terminated', reason }, 1);
        await writeMemory('system:agent_died', { agent: this.name, timestamp: Date.now() }, 10);
        await recordAuditEvent('agent_apoptosis', this.name, 'self_terminated', { reason });
      } catch (e) {
        console.error(`[APOPTOSIS] Background cleanup failed for ${this.name}: ${e.message}`);
      }
    });
  }

  async initialize() {
    this._checkVitals();
    return true;
  }

  async think(prompt, systemPrompt) {
    this._checkVitals();
    return safeGroqJSON(prompt, systemPrompt, this.name);
  }

  async remember(key, value, ttl = 3600) {
    this._checkVitals();
    return writeMemory(`agent:${this.name}:${key}`, value, ttl);
  }

  async recall(key) {
    this._checkVitals();
    return readMemory(`agent:${this.name}:${key}`);
  }

  async run(input = {}) {
    this._checkVitals();
    throw new Error("run() method must be implemented by the subclass");
  }

  async runDiagnostic() {
    this._checkVitals();
    return { agent: this.name, layer: this.layer, status: this.status, anomaly_score: this.anomalyScore };
  }
}
