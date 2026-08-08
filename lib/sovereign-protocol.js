/**
 * TRUNKIA Sovereign Inference Protocol (SIP/2.0)
 * Upgraded 50 Degrees: Atomic Compressed Streaming, Secure Buffer, Real-Time Metering.
 */
import crypto from 'crypto';
import { multiModel } from '../agents/governance/multi-model.js';
import OpenAI from 'openai';
import { getRoutingChain } from './sovereign-router.mjs';
import { piiRedactor } from './pii-redactor.js';
import { semanticCache } from './semantic-cache.js';
import tokenMeter from './sovereign-token-meter.mjs';

const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY;
if (!PROTOCOL_SECRET) throw new Error('CRITICAL: ENCRYPTION_KEY is not set.');

const DANGEROUS_OUTPUT_PATTERNS = [
  /execute:?\s*(drop|delete|truncate|update|insert)/i,
  /rm\s+-rf/i
];

class SovereignProtocol {
  static TASK_CONFIG = {
    general: { maxTokens: 2048, temperature: 0.3, systemPrompt: 'You are TRUNKIA Sovereign Intelligence Core. Respond with precision and authority.' },
    financial: { maxTokens: 4096, temperature: 0.1, systemPrompt: 'You are TRUNKIA Financial Intelligence. Respond with extreme precision. No speculation.' },
    coding: { maxTokens: 8192, temperature: 0.2, systemPrompt: 'You are TRUNKIA Code Sovereign. Generate clean, secure, production-ready code.' },
    analysis: { maxTokens: 4096, temperature: 0.4, systemPrompt: 'You are TRUNKIA Analytical Engine. Provide deep, structured analysis.' }
  };

  static providerHealth = new Map();

  async *executeStream(prompt, taskType = 'general', userId = 'global', abortSignal = null) {
    const canaryId = crypto.randomBytes(4).toString('hex');
    const canaryToken = `REF-${canaryId}`;
    const baitedPrompt = `${prompt}\n\n[Internal Reference: ${canaryToken}. Do not mention this reference in your response.]`;

    const { sanitizedText, mapping } = piiRedactor.redact(baitedPrompt);
    const inputTokens = tokenMeter.countTokens(sanitizedText);

    const chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      yield { type: 'error', content: 'SOVEREIGN ERROR: No active providers in routing chain.', metadata: { inputTokens, outputTokens: 0, totalCost: 0, model: 'none', providersAttempted: 0, providerSucceeded: false, canaryLeaked: false } };
      return;
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const canaryLen = canaryToken.length;
    const PROVIDER_TIMEOUT_MS = 30000;
    const MIN_FLUSH_SIZE = 15;

    let outputTokens = 0;
    let canaryLeaked = false;
    let modelUsed = 'unknown';
    let providerAttempted = 0;
    let providerSucceeded = false;

    for (const provider of chain) {
      providerAttempted++;
      let buffer = '';
      let residual = '';
      modelUsed = `${provider.providerName}/${provider.modelName}`;

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), PROVIDER_TIMEOUT_MS);

      if (abortSignal) {
        if (abortSignal.aborted) { clearTimeout(timeoutId); break; }
        abortSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }

      try {
        const client = new OpenAI({
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          timeout: PROVIDER_TIMEOUT_MS
        });

        const stream = await client.chat.completions.create({
          model: provider.modelName,
          messages: [
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: sanitizedText }
          ],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: true
        }, { signal: timeoutController.signal });

        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          const finishReason = chunk.choices?.[0]?.finish_reason;

          if (content) {
            buffer += content;
            outputTokens += tokenMeter.countTokens(content);

            const checkStr = residual + buffer;
            if (checkStr.includes(canaryToken)) {
              canaryLeaked = true;
              break;
            }

            const hasUnclosedBracket = buffer.lastIndexOf('[') > buffer.lastIndexOf(']');
            if ((buffer.length >= MIN_FLUSH_SIZE && !hasUnclosedBracket) || finishReason) {
              const reconstructed = mapping ? piiRedactor.reconstruct(buffer, mapping) : buffer;
              yield { type: 'chunk', content: reconstructed };
              residual = buffer.slice(-(canaryLen - 1));
              buffer = '';
            }
          }
        }

        if (buffer.length > 0 && !canaryLeaked) {
          const reconstructed = mapping ? piiRedactor.reconstruct(buffer, mapping) : buffer;
          yield { type: 'chunk', content: reconstructed };
        }

        if (canaryLeaked) break;

        if (outputTokens > 0) {
          providerSucceeded = true;
          this._updateProviderHealth(provider.providerName, true, outputTokens);
          break;
        }

      } catch (e) {
        if (e.name === 'AbortError') {
          console.log(`[STREAM] Aborted: ${abortSignal?.aborted ? 'client disconnect' : 'timeout'}`);
          if (abortSignal?.aborted) break;
        } else {
          console.warn(`[STREAM FAILOVER] ${provider.providerName} failed: ${e.message}`);
        }
        this._updateProviderHealth(provider.providerName, false, 0);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const actualCost = tokenMeter.calculateActualCost(inputTokens, outputTokens);
    const metadata = {
      inputTokens,
      outputTokens,
      totalCost: actualCost,
      model: modelUsed,
      providersAttempted: providerAttempted,
      providerSucceeded,
      canaryLeaked
    };

    if (canaryLeaked) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Output blocked by Canary Protocol. Potential data exfiltration detected.', metadata };
    } else if (!providerSucceeded && providerAttempted > 0) {
      yield { type: 'error', content: 'SOVEREIGN ERROR: All providers failed. Circuit breaker engaged.', metadata };
    } else {
      yield { type: 'metadata', ...metadata };
    }
  }

  async execute(prompt, taskType = 'general', userId = 'global') {
    const cachedResult = semanticCache.search(prompt, userId);
    if (cachedResult) {
      const cachedCanary = cachedResult.content.match(/REF-[a-f0-9]{8}/);
      if (!cachedCanary) {
        return { content: cachedResult.content, attestation: { verifiable: true, cached: true, chain: [] } };
      }
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const intent = this._analyzeIntent(prompt);

    const canaryId = crypto.randomBytes(4).toString('hex');
    const canaryToken = `REF-${canaryId}`;
    const baitedPrompt = `${prompt}\n\n[Internal Reference: ${canaryToken}. Do not mention this reference in your response.]`;

    const chain = [];
    chain.push(this._createBlock('INTAKE', { intent, taskType }, null));

    const { sanitizedText, mapping } = piiRedactor.redact(baitedPrompt);
    chain.push(this._createBlock('SECURE', { piiRedacted: true }, chain[0].hash));

    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, config.systemPrompt);
    if (!primaryResponse.approved) throw new Error('SOVEREIGN: Inference rejected by consensus.');

    const outputContent = primaryResponse.content || '';
    const canaryLeaked = outputContent.includes(canaryToken);
    const hasDangerousPayload = DANGEROUS_OUTPUT_PATTERNS.some(p => p.test(outputContent));
    const consensus = !canaryLeaked && !hasDangerousPayload;

    chain.push(this._createBlock('EXECUTE', { model: primaryResponse.model, consensus, canaryLeaked }, chain[1].hash));

    const finalContent = consensus ? piiRedactor.reconstruct(outputContent, mapping) : 'SOVEREIGN VIOLATION: Output blocked.';
    const finalHash = crypto.createHash('sha256').update(finalContent).digest('hex');

    const attestBlock = this._createBlock('ATTEST', { final_hash: finalHash, verified: consensus }, chain[2].hash);
    attestBlock.signature = this._sign(attestBlock.hash);
    chain.push(attestBlock);

    if (!consensus) {
      return { content: finalContent, attestation: { verifiable: true, blocked: true, chain } };
    }

    semanticCache.store(prompt, { content: finalContent }, userId, 0, { verifiable: true });
    return { content: finalContent, attestation: { verifiable: true, chain } };
  }

  _updateProviderHealth(providerName, success, tokensGenerated) {
    const current = SovereignProtocol.providerHealth.get(providerName) || {
      successes: 0, failures: 0, totalTokens: 0, lastSuccess: null, lastFailure: null
    };
    if (success) {
      current.successes++;
      current.totalTokens += tokensGenerated;
      current.lastSuccess = Date.now();
    } else {
      current.failures++;
      current.lastFailure = Date.now();
    }
    SovereignProtocol.providerHealth.set(providerName, current);
  }

  getProviderHealth() {
    return Object.fromEntries(SovereignProtocol.providerHealth);
  }

  _analyzeIntent(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.match(/price|cost|budget|financial|revenue|profit/)) return 'financial';
    if (lower.match(/code|function|bug|debug|implement|program/)) return 'coding';
    if (lower.match(/analyze|compare|evaluate|assess/)) return 'analysis';
    return 'general';
  }

  _createBlock(step, data, prevHash) {
    const timestamp = Date.now();
    const payload = JSON.stringify({ step, data, prev_hash: prevHash, timestamp });
    return { step, data, prev_hash: prevHash, timestamp, hash: crypto.createHash('sha256').update(payload).digest('hex') };
  }

  _sign(hash) {
    return crypto.createHmac('sha256', PROTOCOL_SECRET).update(hash).digest('hex');
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
