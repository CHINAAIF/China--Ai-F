import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { semanticCache } from '../../lib/semantic-cache.js';
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

    if (this.apiKey) {
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

  async runSingle(taskType, prompt, systemPrompt = '', userId = 'global') {
    // 0. جدار الحماية الدلالي: منع حقن الأوامر قبل أي معالجة
    if (!isSafePrompt(prompt)) {
      return SAFE_BLOCK_RESPONSE;
    }

    // 1. فحص الـ Semantic Cache أولاً (Zero-Cost Path)
    const cached = semanticCache.search(prompt, userId);
    if (cached) {
      return cached;
    }

    // 2. إذا لم يكن موجوداً، نستدعي المزود
    const candidates = this.getBestProviders(taskType);
    if (candidates.length === 0) {
      return { approved: false, error: 'No active providers available.' };
    }

    for (const provider of candidates) {
      const startTime = Date.now();
      try {
        const model = provider.models[0];
        const res = await provider.client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt || 'You are TRUNKIA Sovereign Intelligence Core.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1024,
          temperature: 0.3
        });

        const latency = Date.now() - startTime;
        provider.recordSuccess(latency);

        const rawContent = res.choices?.[0]?.message?.content || "";
        const dlpResult = dlpEngine.scan(rawContent, provider.name, userId);
        const result = {
          approved: true,
          content: dlpResult.sanitizedContent,
          model: `${provider.name}/${model}`,
          tokens: res.usage?.total_tokens,
          latency_ms: latency
        };

        // 3. تخزين النتيجة الناجحة في الـ Cache لطلب يستفيد منها مستقبلاً
        semanticCache.store(prompt, result, userId, result.tokens);

        return result;

      } catch (err) {
        provider.recordFailure();
        console.error(`[InferenceGateway] Provider ${provider.name} failed: ${err.message}`);
      }
    }

    return { approved: false, error: 'All available inference providers failed.' };
  }


  async runConsensus(prompt, userId = "global") {
    if (!isSafePrompt(prompt)) return SAFE_BLOCK_RESPONSE;
    const candidates = this.getBestProviders("consensus");
    if (candidates.length === 0) return { approved: false, error: "No active providers available for consensus." };
    const consensusCandidates = candidates.slice(0, 3);
    const promises = consensusCandidates.map(async (provider) => {
      const startTime = Date.now();
      const model = provider.models[0];
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 12000));
      try {
        const res = await Promise.race([provider.client.chat.completions.create({ model, messages: [{ role: "system", content: "You are TRUNKIA." }, { role: "user", content: prompt }], max_tokens: 1024, temperature: 0.2 }), timeoutPromise]);
        const latency = Date.now() - startTime;
        provider.recordSuccess(latency);
        return { success: true, provider, model, content: res.choices?.[0]?.message?.content || "", tokens: res.usage?.total_tokens, latency };
      } catch (err) { provider.recordFailure(); return { success: false }; }
    });
    const results = await Promise.all(promises);
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length === 0) return { approved: false, error: "Consensus failed." };
    const bestResult = successfulResults[0];
    const dlpResult = dlpEngine.scan(bestResult.content, "consensus:" + bestResult.provider.name, userId);
    const finalResult = { approved: true, content: dlpResult.sanitizedContent, model: bestResult.provider.name + "/" + bestResult.model, tokens: bestResult.tokens, latency_ms: bestResult.latency, consensus_achieved: successfulResults.length, dlp_incidents: dlpResult.incidents.length };
    semanticCache.store(prompt, finalResult, userId, finalResult.tokens);
    return finalResult;
  }
  async runByModelName(modelKey, prompt, systemPrompt = "", userId = "global") {
    if (!isSafePrompt(prompt)) return SAFE_BLOCK_RESPONSE;
    const provider = this.providers.find(p => p.isAvailable() && p.models.includes(modelKey));
    if (!provider) return { approved: false, error: "Model not available." };
    const startTime = Date.now();
    try {
      const res = await provider.client.chat.completions.create({ model: modelKey, messages: [{ role: "system", content: systemPrompt || "You are TRUNKIA." }, { role: "user", content: prompt }], max_tokens: 1024, temperature: 0.3 });
      const latency = Date.now() - startTime;
      provider.recordSuccess(latency);
      const rawContent = res.choices?.[0]?.message?.content || "";
      const dlpResult = dlpEngine.scan(rawContent, provider.name, userId);
      return { approved: true, content: dlpResult.sanitizedContent, model: provider.name + "/" + modelKey, tokens: res.usage?.total_tokens, latency_ms: latency, dlp_incidents: dlpResult.incidents.length };
    } catch (err) { provider.recordFailure(); return { approved: false, error: "Inference failed." }; }
  }
  async runGroq(prompt, systemPrompt = "", userId = "global") {
    if (!isSafePrompt(prompt)) return SAFE_BLOCK_RESPONSE;
    const provider = this.providers.find(p => p.name === "groq" && p.isAvailable());
    if (!provider) return { approved: false, error: "Groq provider not available." };
    const startTime = Date.now();
    const model = provider.models[0];
    try {
      const res = await provider.client.chat.completions.create({ model, messages: [{ role: "system", content: systemPrompt || "You are TRUNKIA." }, { role: "user", content: prompt }], max_tokens: 1024, temperature: 0.3 });
      const latency = Date.now() - startTime;
      provider.recordSuccess(latency);
      const rawContent = res.choices?.[0]?.message?.content || "";
      const dlpResult = dlpEngine.scan(rawContent, provider.name, userId);
      return { approved: true, content: dlpResult.sanitizedContent, model: provider.name + "/" + model, tokens: res.usage?.total_tokens, latency_ms: latency, dlp_incidents: dlpResult.incidents.length };
    } catch (err) { provider.recordFailure(); return { approved: false, error: "Inference failed." }; }
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
