import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isSafePrompt, SAFE_BLOCK_RESPONSE } from '../../lib/input-guard.js';
import { dlpEngine } from '../../lib/dlp-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProviderState {
  constructor(config) {
    this.name = config.name;
    this.baseURL = config.baseURL;
    this.apiKey = process.env[config.envKey];
    this.priority = config.priority;
    this.models = config.models;
    this.client = null;
    this.failures = 0;
    this.lastFailure = 0;
    this.latency = 1000;
    this.circuitOpen = false;

    if (this.apiKey || this.envKey === 'OLLAMA_ENABLED') {
      this.client = new OpenAI({ baseURL: this.baseURL, apiKey: this.apiKey });
    }
  }

  isAvailable() {
    if (!this.client) return false;
    if (this.circuitOpen) {
      if (Date.now() - this.lastFailure > 30000) {
        this.circuitOpen = false;
        this.failures = 0;
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(latency) {
    this.failures = 0;
    this.circuitOpen = false;
    this.latency = (this.latency * 0.7) + (latency * 0.3);
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= 3) {
      this.circuitOpen = true;
      console.warn(`[InferenceGateway] Circuit OPENED for provider ${this.name}`);
    }
  }
}

class InferenceGateway {
  constructor() {
    this.providers = [];
    this.loadProviders();
  }

  loadProviders() {
    try {
      const configPath = path.resolve(__dirname, '../../config/inference-providers.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      this.providers = config.providers.map(p => new ProviderState(p));
      const activeCount = this.providers.filter(p => p.client).length;
      console.log(`[InferenceGateway] Initialized ${activeCount} active providers out of ${this.providers.length} configured.`);
    } catch (err) {
      console.error('[InferenceGateway] FATAL: Could not load providers config:', err.message);
    }
  }

  getBestProviders(taskType) {
    let available = this.providers.filter(p => p.isAvailable());
    if (available.length === 0) return [];
    available.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.latency - b.latency;
    });
    return available;
  }

  // Helper to execute inference with strict timeout
  async _executeWithTimeout(provider, model, prompt, systemPrompt, temp, timeoutMs = 10000) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Provider Timeout')), timeoutMs)
    );

    try {
      const res = await Promise.race([
        provider.client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt || 'You are TRUNKIA Sovereign Intelligence Core.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1024,
          temperature: temp
        }),
        timeoutPromise
      ]);
      return { success: true, res };
    } catch (err) {
      return { success: false, err };
    }
  }

  async runSingle(taskType, prompt, systemPrompt = '', userId = 'global') {
    if (!isSafePrompt(prompt)) return SAFE_BLOCK_RESPONSE;

    const candidates = this.getBestProviders(taskType);
    if (candidates.length === 0) return { approved: false, error: 'No active providers available.' };

    for (const provider of candidates) {
      const startTime = Date.now();
      // Fix: Read model based on tier (taskType) instead of array index
      const model = provider.models[taskType] || provider.models.standard || provider.models[0];
      if (!model) {
        provider.recordFailure();
        continue;
      }

      const fetchResult = await this._executeWithTimeout(provider, model, prompt, systemPrompt, 0.3, 10000);

      if (!fetchResult.success) {
        provider.recordFailure();
        console.error(`[InferenceGateway] Provider ${provider.name} failed: ${fetchResult.err.message}`);
        continue;
      }

      const latency = Date.now() - startTime;
      provider.recordSuccess(latency);

      const rawContent = fetchResult.res.choices?.[0]?.message?.content || '';
      const dlpResult = dlpEngine.scan(rawContent, provider.name, userId);

      return {
        approved: true,
        content: dlpResult.sanitizedContent,
        model: `${provider.name}/${model}`,
        tokens: fetchResult.res.usage?.total_tokens,
        latency_ms: latency
      };
    }

    return { approved: false, error: 'All available inference providers failed.' };
  }

  getHealthStatus() {
    return this.providers.map(p => ({
      name: p.name,
      configured: !!p.client,
      available: p.isAvailable(),
      failures: p.failures,
      circuit_open: p.circuitOpen,
      avg_latency_ms: Math.round(p.latency)
    }));
  }
}

export const multiModel = new InferenceGateway();
export default multiModel;
