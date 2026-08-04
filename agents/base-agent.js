/**
 * TRUNKIA Standard Agent Base Class (With Digital Apoptosis)
 * أي وكيل جديد يجب أن يرث من هذا الكلاس لضمان التوافق التام مع الذاكرة المشتركة والبوابة.
 */
import { writeMemory, readMemory } from '../lib/blackboard.js';
import { safeGroqJSON } from '../lib/services/safe-json.js';

export class BaseAgent {
  constructor(name, layer) {
    if (!name || !layer) throw new Error("Agent must have a name and layer");
    this.name = name;
    this.layer = layer;
    this.status = 'active';
    this.isTerminated = false; // Apoptosis Flag
    this.anomalyScore = 0;

    // AOP Wrapper: Enforce Apoptosis check on run() even if overridden by subclass
    const originalRun = this.run.bind(this);
    this.run = async (input = {}) => {
      this._checkVitals();
      return originalRun(input);
    };
  }

  // Digital Apoptosis: Programmed Cell Death
  async triggerApoptosis(reason) {
    if (this.isTerminated) return;
    console.warn(`[APOPTOSIS] Agent ${this.name} initiating self-destruct. Reason: ${reason}`);
    
    this.isTerminated = true;
    this.status = 'terminated';
    
    // 1. Wipe local memory from Blackboard (Overwrite with dead state and 1s TTL)
    try {
      await writeMemory(`agent:${this.name}`, { status: 'terminated', reason }, 1);
    } catch (e) {}
  }

  // Check if agent is alive before executing any cognitive function
  _checkVitals() {
    if (this.isTerminated) {
      throw new Error(`[APOPTOSIS] Agent ${this.name} is dead. Execution aborted.`);
    }
  }

  // Receive anomaly signals from Immune System
  async reportAnomaly(score) {
    if (this.isTerminated) return;
    this.anomalyScore += score;
    if (this.anomalyScore > 10) { // Threshold for self-destruct
      await this.triggerApoptosis(`Anomaly score exceeded threshold (${this.anomalyScore})`);
    }
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
