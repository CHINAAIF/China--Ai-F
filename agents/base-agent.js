/**
 * TRUNKIA Standard Agent Base Class
 * أي وكيل جديد يجب أن يرث من هذا الكلاس لضمان التوافق التام مع الذاكرة المشتركة والبوابة.
 */
import { writeMemory, readMemory } from '../lib/blackboard.js';
import { safeGroqJSON } from '../utils/safe-json.js';

export class BaseAgent {
  constructor(name, layer) {
    if (!name || !layer) throw new Error("Agent must have a name and layer");
    this.name = name;
    this.layer = layer;
    this.status = 'active';
  }

  async initialize() {
    return true;
  }

  /**
   * التفكير الموحد: يستخدم البوابة الديناميكية
   */
  async think(prompt, systemPrompt) {
    return safeGroqJSON(prompt, systemPrompt, this.name);
  }

  /**
   * تذكر: حفظ في الذاكرة المشتركة
   */
  async remember(key, value, ttl = 3600) {
    return writeMemory(`agent:${this.name}:${key}`, value, ttl);
  }

  /**
   * استرجاع: قراءة من الذاكرة المشتركة
   */
  async recall(key) {
    return readMemory(`agent:${this.name}:${key}`);
  }

  /**
   * التشغيل: يجب أن يُطبق في الكلاس الابن
   */
  async run(input = {}) {
    throw new Error("run() method must be implemented by the subclass");
  }

  async runDiagnostic() {
    return { agent: this.name, layer: this.layer, status: 'ok' };
  }
}
