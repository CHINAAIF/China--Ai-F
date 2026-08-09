/**
 * TRUNKIA Sovereign Protocol v20.0 (Omega Protocol - Global Edition)
 * Integrated: Deep Decoder, PII Vault, Mid-Stream Failover, Grounding.
 */
import crypto from 'crypto';
import { piiRedactor } from './pii-redactor.js';
import { getRoutingChain } from './sovereign-router.mjs';
import { groundingEngine } from './services/grounding-engine.js';
import { deepDecode } from './services/deep-decoder.js';
import OpenAI from 'openai';
import { multiModel } from '../agents/governance/multi-model.js';
import { semanticCache } from './semantic-cache.js';

const estimateTokens = (text) => {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
};

class SovereignProtocol {
  static TASK_CONFIG = {
    general: { maxTokens: 2048, temperature: 0.3, systemPrompt: 'You are TRUNKIA Sovereign Intelligence Core. Respond with precision. If uncertain, state your uncertainty explicitly. Do not fabricate sources or quotes.' },
    financial: { maxTokens: 4096, temperature: 0.1, systemPrompt: 'You are TRUNKIA Financial Intelligence. Respond with extreme precision. No speculation. Never fabricate financial figures.' },
    coding: { maxTokens: 8192, temperature: 0.2, systemPrompt: 'You are TRUNKIA Code Sovereign. Generate clean, secure, production-ready code. Do not hallucinate APIs.' },
    analysis: { maxTokens: 4096, temperature: 0.4, systemPrompt: 'You are TRUNKIA Analytical Engine. Provide structured analysis. Flag assumptions clearly.' }
  };

  async *executeStream(prompt, taskType = 'general', userId = 'global', abortSignal = null) {
    const sessionId = crypto.randomUUID();
    const canaryId = crypto.randomBytes(4).toString('hex');
    const canaryToken = 'REF-' + canaryId;
    const baitedPrompt = prompt + '\n\n[Internal Reference: ' + canaryToken + '. Do not mention this reference.]';

    // OMEGA: Deep Decode (Prevents Encoding Bypass)
    const promptDecode = deepDecode(baitedPrompt);
    if (promptDecode.rejected) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Obfuscated input rejected (' + promptDecode.reason + ').', metadata: { decodedLayers: promptDecode.layers, inputEntropy: promptDecode.entropy } };
      return;
    }
    const decodedPrompt = promptDecode.decoded;

    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const inputTokens = estimateTokens(sanitizedText);

    let chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      console.warn('[STREAM] DB Routing failed. Using Hardcoded Fallback.');
      chain = [{ providerName: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, modelName: 'llama-3.1-8b-instant' }];
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
    let rollingContext = '';
    let fullTextForGrounding = '';

    for (const provider of chain) {
      providerAttempted++;
      let buffer = '';
      let residual = '';
      modelUsed = provider.providerName + '/' + provider.modelName;
      const recon = piiRedactor.createStreamReconstructor(mapping);

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), PROVIDER_TIMEOUT_MS);

      if (abortSignal) {
        if (abortSignal.aborted) { clearTimeout(timeoutId); break; }
        abortSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }

      try {
        const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey, timeout: PROVIDER_TIMEOUT_MS });
        let messages = [
          { role: 'system', content: config.systemPrompt },
          { role: 'user', content: sanitizedText }
        ];

        if (rollingContext.length > 0) {
          const lastSpace = rollingContext.lastIndexOf(' ');
          const cleanTail = lastSpace !== -1 ? rollingContext.substring(lastSpace + 1) : rollingContext;
          messages.push({ role: 'assistant', content: cleanTail });
          messages.push({ role: 'user', content: '[SYSTEM CONTINUATION DIRECTIVE: Resume seamlessly. Do not repeat or apologize.]' });
        }

        const stream = await client.chat.completions.create({
          model: provider.modelName,
          messages: messages,
          max_tokens: config.maxTokens,
          temperature: rollingContext.length > 0 ? 0.1 : config.temperature,
          stream: true
        }, { signal: timeoutController.signal });

        let providerYielded = false;

        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          const finishReason = chunk.choices?.[0]?.finish_reason;

          if (content) {
            providerYielded = true;
            buffer += content;
            fullTextForGrounding += content;
            rollingContext = (rollingContext + content).slice(-150);
            outputTokens += estimateTokens(content);

            const checkStr = residual + buffer;
            if (checkStr.includes(canaryToken)) { canaryLeaked = true; break; }

            const hasUnclosedBracket = buffer.lastIndexOf('[') > buffer.lastIndexOf(']');
            if ((buffer.length >= MIN_FLUSH_SIZE && !hasUnclosedBracket) || finishReason) {
              const reconstructed = recon.process(buffer);
              if (reconstructed) yield { type: 'chunk', content: reconstructed };
              residual = buffer.slice(-(canaryLen - 1));
              buffer = '';
            }
          }
        }

        if (buffer.length > 0 && !canaryLeaked) {
          const reconstructed = recon.process(buffer);
          if (reconstructed) yield { type: 'chunk', content: reconstructed };
        }
        const finalFlush = recon.flush();
        if (finalFlush) yield { type: 'chunk', content: finalFlush };

        if (canaryLeaked) break;
        if (providerYielded || outputTokens > 0) { providerSucceeded = true; break; }

      } catch (e) {
        if (e.name === 'AbortError') {
          if (abortSignal?.aborted) break;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const groundingResult = groundingEngine.ground(fullTextForGrounding);
    const actualCost = inputTokens + outputTokens;
    const metadata = { inputTokens, outputTokens, totalCost: actualCost, model: modelUsed, providersAttempted: providerAttempted, providerSucceeded, canaryLeaked, decodedLayers: promptDecode.layers };

    if (canaryLeaked) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Canary Token leaked.', metadata, grounding: groundingResult };
    } else if (!providerSucceeded && providerAttempted > 0) {
      yield { type: 'error', content: 'SOVEREIGN ERROR: All providers failed.', metadata, grounding: groundingResult };
    } else {
      yield { type: 'metadata', ...metadata, grounding: groundingResult };
    }

    await piiRedactor.cleanupSession(sessionId).catch(() => {});
  }

  async execute(prompt, taskType = 'general', userId = 'global') {
    const sessionId = crypto.randomUUID();
    const promptDecode = deepDecode(prompt);
    if (promptDecode.rejected) throw new Error('Obfuscated input rejected: ' + promptDecode.reason);
    const decodedPrompt = promptDecode.decoded;

    const cachedResult = semanticCache.search(decodedPrompt, userId);
    if (cachedResult) {
      const grounding = groundingEngine.ground(cachedResult.content);
      return { content: cachedResult.content, attestation: { verifiable: true, cached: true, grounding } };
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, config.systemPrompt);

    if (!primaryResponse.approved) throw new Error('Inference rejected');
    let finalContent = await piiRedactor.reconstruct(primaryResponse.content, sessionId, mapping);

    const grounding = groundingEngine.ground(finalContent);
    if (!grounding.grounded) {
      finalContent += '\n\n[GROUNDING NOTICE: This response may contain internal contradictions. Please verify independently.]';
    }

    semanticCache.store(decodedPrompt, { content: finalContent }, userId, 0, { verifiable: true, grounding });
    await piiRedactor.cleanupSession(sessionId).catch(() => {});
    return { content: finalContent, attestation: { verifiable: true, grounding } };
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
