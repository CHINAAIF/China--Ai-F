/**
 * TRUNKIA Provider Mesh v2.1 (Omega Protocol)
 * 
 * Complete Rewrite:
 * 1. Correct ESM Exports (export class + export const)
 * 2. Unified Race Generator (Yields chunks, metadata, errors)
 * 3. Internal Health Tracking & Sorting
 * 4. Mid-Stream Failover with Rolling Context
 * 5. Integrated Stream Guard & Canary Detection
 */
import OpenAI from 'openai';
import { streamGuard } from './stream-guard.js';

export class ProviderMesh {
  constructor() {
    this.health = new Map();
  }

  recordSuccess(providerName) {
    const s = this.health.get(providerName) || { successes: 0, failures: 0 };
    s.successes++;
    this.health.set(providerName, s);
  }

  recordFailure(providerName) {
    const s = this.health.get(providerName) || { successes: 0, failures: 0 };
    s.failures++;
    this.health.set(providerName, s);
  }

  sortChain(chain) {
    if (!chain || chain.length <= 1) return chain || [];
    return [...chain].sort((a, b) => {
      const aS = this.health.get(a.providerName) || { successes: 0, failures: 0 };
      const bS = this.health.get(b.providerName) || { successes: 0, failures: 0 };
      return (bS.successes / (bS.successes + bS.failures + 1)) - (aS.successes / (aS.successes + aS.failures + 1));
    });
  }

  async *race(sanitizedText, chain, config, canaryToken, abortSignal) {
    let rollingContext = '';
    let modelUsed = 'unknown';
    let providerSucceeded = false;

    for (const provider of chain) {
      try {
        const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey, timeout: 30000 });
        const messages = [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: sanitizedText }
        ];

        if (rollingContext.length > 0) {
          const lastSpace = rollingContext.lastIndexOf(' ');
          messages.push({ role: 'assistant', content: lastSpace !== -1 ? rollingContext.substring(lastSpace + 1) : rollingContext });
          messages.push({ role: 'user', content: '[SYSTEM CONTINUATION DIRECTIVE: Resume seamlessly. Do not repeat or apologize.]' });
        }

        const stream = await client.chat.completions.create({
          model: provider.modelName,
          messages,
          max_tokens: config.maxTokens,
          temperature: rollingContext.length > 0 ? 0.1 : config.temperature,
          stream: true
        }, { signal: abortSignal });

        let providerYielded = false;

        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          if (content) {
            providerYielded = true;
            rollingContext = (rollingContext + content).slice(-150);
            
            // Security checks applied on raw text before yielding
            if (rollingContext.includes(canaryToken)) {
              yield { type: 'error', content: 'CANARY_LEAK_DETECTED' };
              return;
            }
            
            const guardResult = streamGuard.check(rollingContext, canaryToken);
            if (guardResult.violated) {
              yield { type: 'error', content: 'CONTENT_FILTER_TRIGGERED' };
              return;
            }
            
            yield { type: 'chunk', content };
          }
        }
        
        if (providerYielded) {
          this.recordSuccess(provider.providerName);
          providerSucceeded = true;
          modelUsed = provider.providerName + '/' + provider.modelName;
          break; 
        }
      } catch (e) {
        this.recordFailure(provider.providerName);
        if (e.name === 'AbortError') break;
      }
    }
    
    yield { type: 'metadata', providerSucceeded, model: modelUsed };
  }
}

export const providerMesh = new ProviderMesh();
export default providerMesh;
