import Groq from 'groq-sdk';

/**
 * TRUNKIA Enterprise Inference Gateway
 * Implements Circuit Breakers, Latency Tracking, and Smart Failover.
 */

class ProviderState {
  constructor(name, client, models, priority) {
    this.name = name;
    this.client = client;
    this.models = models;
    this.priority = priority; // 1 = highest
    this.failures = 0;
    this.lastFailure = 0;
    this.latency = 1000; // EMA Latency in ms
    this.circuitOpen = false;
  }

  recordSuccess(latency) {
    this.failures = 0;
    this.circuitOpen = false;
    // Exponential Moving Average for latency (alpha = 0.3)
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

  isAvailable() {
    if (this.circuitOpen) {
      // Half-Open state: try again after 30 seconds
      if (Date.now() - this.lastFailure > 30000) {
        this.circuitOpen = false;
        this.failures = 0;
        console.log(`[InferenceGateway] Circuit HALF-OPEN for provider ${this.name}. Retrying...`);
        return true;
      }
      return false;
    }
    return true;
  }
}

class InferenceGateway {
  constructor() {
    this.providers = [];
    this.initProviders();
  }

  initProviders() {
    // Initialize Groq
    if (process.env.GROQ_API_KEY) {
      this.providers.push(
        new ProviderState(
          'groq',
          new Groq({ apiKey: process.env.GROQ_API_KEY }),
          ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
          1
        )
      );
    }
    // Future providers can be pushed here (Gemini, DeepSeek, etc.)
    // We keep the structure ready for dynamic scaling.
  }

  getBestProviders(taskType) {
    // 1. Filter by availability (Circuit Breaker check)
    let available = this.providers.filter(p => p.isAvailable());
    
    if (available.length === 0) {
      console.error('[InferenceGateway] FATAL: All providers circuits are OPEN!');
      return [];
    }

    // 2. Sort by Priority first, then by Latency (fastest first)
    available.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.latency - b.latency;
    });

    return available;
  }

  async runSingle(taskType, prompt, systemPrompt = '') {
    const candidates = this.getBestProviders(taskType);
    
    for (const provider of candidates) {
      const startTime = Date.now();
      try {
        let result;
        if (provider.name === 'groq') {
          result = await this._executeGroq(provider, prompt, systemPrompt);
        }
        // Add other providers execution here

        const latency = Date.now() - startTime;
        provider.recordSuccess(latency);
        
        return {
          approved: true,
          content: result.content,
          model: `${provider.name}/${result.model}`,
          tokens: result.tokens,
          latency_ms: latency
        };

      } catch (err) {
        const latency = Date.now() - startTime;
        provider.recordFailure();
        console.error(`[InferenceGateway] Provider ${provider.name} failed in ${latency}ms: ${err.message}`);
        // Continue to next provider (Failover)
      }
    }

    // If we reach here, all providers failed
    return { approved: false, error: 'All inference providers failed or circuits are open.' };
  }

  async _executeGroq(provider, prompt, systemPrompt) {
    const model = provider.models[0]; // Default to first model
    const res = await provider.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt || 'You are TRUNKIA Sovereign Intelligence Core.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });

    return {
      content: res.choices[0].message.content,
      model: model,
      tokens: res.usage?.total_tokens
    };
  }

  getHealthStatus() {
    return this.providers.map(p => ({
      name: p.name,
      available: p.isAvailable(),
      failures: p.failures,
      circuit_open: p.circuitOpen,
      avg_latency_ms: Math.round(p.latency)
    }));
  }

  /**
   * توجيه طلب إلى مزود ونموذج محدد بالاسم (يُستخدم لمحرك اختبار الأداء)
   */
  async runSpecificModel(providerName, modelName, prompt, systemPrompt = '') {
    const provider = this.providers.find(p => p.name === providerName && p.client);
    if (!provider || !provider.isAvailable()) {
      throw new Error(`Provider ${providerName} not available or circuit open.`);
    }

    const startTime = Date.now();
    try {
      const res = await provider.client.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt || 'You are TRUNKIA Sovereign Intelligence Core.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.3
      });

      const latency = Date.now() - startTime;
      provider.recordSuccess(latency);

      return {
        approved: true,
        content: res.choices?.[0]?.message?.content,
        model: `${providerName}/${modelName}`,
        tokens: res.usage?.total_tokens,
        latency_ms: latency
      };
    } catch (err) {
      provider.recordFailure();
      throw err;
    }
  }

  /**
   * يُرجع قائمة بكل المزودين والنماذج المُهيأة (للمحرك الاختبار)
   */
  getAllAvailableModels() {
    let models = [];
    this.providers.forEach(p => {
      if (p.client) {
        p.models.forEach(m => models.push({ provider: p.name, model: m }));
      }
    });
    return models;
  }
}

// Export as singleton to maintain state across the application
export const multiModel = new InferenceGateway();
export default multiModel;
