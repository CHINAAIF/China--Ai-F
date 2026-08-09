/**
 * TRUNKIA Sovereign Protocol v24.0 (Omega Protocol - Enterprise Edition)
 * Integrated: Semantic Cache v2.0, QuotaContext, Deep Decoder, PII Vault, Truth Tribunal, Stream Guard.
 */
import crypto from 'crypto';
import { piiRedactor } from './pii-redactor.js';
import { getRoutingChain } from './sovereign-router.mjs';
import { groundingEngine } from './services/grounding-engine.js';
import { deepDecode } from './services/deep-decoder.js';
import { truthTribunal } from './services/truth-tribunal.js';
import { streamGuard } from './services/stream-guard.js';
import { semanticCache } from './semantic-cache.js';
import OpenAI from 'openai';
import { multiModel } from '../agents/governance/multi-model.js';

const estimateTokens = (text) => {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
};

class SovereignProtocol {
  static TASK_CONFIG = {
    general: { maxTokens: 2048, temperature: 0.3, systemPrompt: 'You are TRUNKIA Sovereign Intelligence Core. Respond with precision.' },
    financial: { maxTokens: 4096, temperature: 0.1, systemPrompt: 'You are TRUNKIA Financial Intelligence. Extreme precision.' },
    coding: { maxTokens: 8192, temperature: 0.2, systemPrompt: 'You are TRUNKIA Code Sovereign. Generate clean, secure code.' },
    analysis: { maxTokens: 4096, temperature: 0.4, systemPrompt: 'You are TRUNKIA Analytical Engine. Provide structured analysis.' }
  };

  async *executeStream(prompt, taskType, userId, abortSignal, quotaContext) {
    const sessionId = crypto.randomUUID();
    const canaryToken = 'REF-' + crypto.randomBytes(4).toString('hex');
    const baitedPrompt = prompt + '\n\n[Internal Reference: ' + canaryToken + '. Do not mention this reference.]';

    const decodeResult = deepDecode(baitedPrompt);
    if (decodeResult.rejected) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Obfuscated input rejected.', metadata: { reason: decodeResult.reason } };
      return;
    }
    const decodedPrompt = decodeResult.decoded;

    // === SEMANTIC CACHE CHECK (Stream) ===
    const cachedStream = await semanticCache.search(decodedPrompt, userId);
    if (cachedStream) {
      yield { type: 'chunk', content: cachedStream.content };
      yield { type: 'metadata', inputTokens: 0, outputTokens: 0, totalCost: 0, model: 'semantic-cache', providerSucceeded: true, canaryLeaked: false, contentFilterTriggered: false, quotaExhausted: false, cached: true, similarity: cachedStream.similarity, grounding: { grounded: true, confidence: 100 }, tribunal: { verdict: 'ACCEPTED', confidence: 100 } };
      if (quotaContext) await quotaContext.settle();
      await piiRedactor.cleanupSession(sessionId).catch(() => {});
      return;
    }

    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const inputTokens = estimateTokens(sanitizedText);

    let chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      chain = [{ providerName: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, modelName: 'llama-3.1-8b-instant' }];
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    let outputTokens = 0, canaryLeaked = false, contentFilterTriggered = false, quotaExhausted = false, providerSucceeded = false, modelUsed = 'unknown';
    let rollingContext = '', fullText = '';

    for (const provider of chain) {
      let buffer = '', residual = '';
      modelUsed = provider.providerName + '/' + provider.modelName;
      const recon = piiRedactor.createStreamReconstructor(mapping);
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 30000);

      if (abortSignal) {
        if (abortSignal.aborted) { clearTimeout(timeoutId); break; }
        abortSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }

      try {
        const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey, timeout: 30000 });
        let messages = [{ role: 'system', content: config.systemPrompt }, { role: 'user', content: sanitizedText }];
        if (rollingContext.length > 0) {
          const lastSpace = rollingContext.lastIndexOf(' ');
          messages.push({ role: 'assistant', content: lastSpace !== -1 ? rollingContext.substring(lastSpace + 1) : rollingContext });
          messages.push({ role: 'user', content: '[SYSTEM CONTINUATION DIRECTIVE: Resume seamlessly.]' });
        }

        const stream = await client.chat.completions.create({ model: provider.modelName, messages, max_tokens: config.maxTokens, temperature: rollingContext.length > 0 ? 0.1 : config.temperature, stream: true }, { signal: timeoutController.signal });
        let providerYielded = false;

        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (content) {
            providerYielded = true;
            buffer += content;
            fullText += content;
            rollingContext = (rollingContext + content).slice(-150);
            const chunkTokens = estimateTokens(content);
            outputTokens += chunkTokens;

            if (quotaContext) {
              const quotaOk = await quotaContext.meter(chunkTokens);
              if (!quotaOk) { quotaExhausted = true; break; }
            }

            const checkStr = residual + buffer;
            if (checkStr.includes(canaryToken)) { canaryLeaked = true; break; }

            const guardResult = streamGuard.check(fullText, canaryToken);
            if (guardResult.violated) { contentFilterTriggered = true; break; }

            const hasUnclosedBracket = buffer.lastIndexOf('[') > buffer.lastIndexOf(']');
            if ((buffer.length >= 15 && !hasUnclosedBracket) || finishReason) {
              const reconstructed = recon.process(buffer);
              if (reconstructed) yield { type: 'chunk', content: reconstructed };
              residual = buffer.slice(-(canaryToken.length - 1));
              buffer = '';
            }
          }
        }

        if (buffer.length > 0 && !canaryLeaked && !contentFilterTriggered && !quotaExhausted) {
          const reconstructed = recon.process(buffer);
          if (reconstructed) yield { type: 'chunk', content: reconstructed };
        }
        const finalFlush = recon.flush();
        if (finalFlush) yield { type: 'chunk', content: finalFlush };

        if (canaryLeaked || contentFilterTriggered || quotaExhausted) break;
        if (providerYielded || outputTokens > 0) { providerSucceeded = true; break; }
      } catch (e) {
        if (e.name === 'AbortError' && abortSignal?.aborted) break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    let groundingResult, tribunalResult;
    try {
      groundingResult = groundingEngine.ground(fullText);
      tribunalResult = await truthTribunal.verify(decodedPrompt, fullText, taskType, groundingResult);
    } finally {
      if (quotaContext) await quotaContext.settle();
    }

    // === STORE IN SEMANTIC CACHE ===
    if (tribunalResult && tribunalResult.verdict === 'ACCEPTED' && tribunalResult.confidence >= 80) {
      await semanticCache.store(decodedPrompt, { content: fullText }, userId, 3600, { verifiable: true, grounding: groundingResult, tribunal: tribunalResult });
    }

    const responseSignature = crypto.createHmac('sha256', process.env.IMMUNE_SECRET || 'fallback').update(fullText).digest('hex');

    yield {
      type: 'metadata',
      inputTokens, outputTokens, totalCost: inputTokens + outputTokens,
      model: modelUsed, providerSucceeded, canaryLeaked, contentFilterTriggered, quotaExhausted,
      grounding: groundingResult, tribunal: tribunalResult, signature: responseSignature
    };

    await piiRedactor.cleanupSession(sessionId).catch(() => {});
  }

  async execute(prompt, taskType, userId, quotaContext) {
    const sessionId = crypto.randomUUID();
    const decodeResult = deepDecode(prompt);
    if (decodeResult.rejected) throw new Error('Obfuscated input rejected');
    const decodedPrompt = decodeResult.decoded;

    const cachedResult = await semanticCache.search(decodedPrompt, userId);
    if (cachedResult) {
      const grounding = groundingEngine.ground(cachedResult.content);
      const tribunal = await truthTribunal.verify(decodedPrompt, cachedResult.content, taskType, grounding);
      if (quotaContext) await quotaContext.settle();
      return { content: cachedResult.content, attestation: { verifiable: true, cached: true, grounding, tribunal } };
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, config.systemPrompt);
    if (!primaryResponse.approved) throw new Error('Inference rejected');
    let finalContent = await piiRedactor.reconstruct(primaryResponse.content, sessionId, mapping);

    if (quotaContext) {
      await quotaContext.meter(estimateTokens(finalContent));
      await quotaContext.settle();
    }

    const grounding = groundingEngine.ground(finalContent);
    const tribunal = await truthTribunal.verify(decodedPrompt, finalContent, taskType, grounding);
    if (tribunal.verdict !== 'ACCEPTED') {
      finalContent += '\n\n[TRIBUNAL NOTICE: This response was flagged by the Truth Tribunal.]';
    }

    if (tribunal.verdict === 'ACCEPTED' && tribunal.confidence >= 80) {
      await semanticCache.store(decodedPrompt, { content: finalContent }, userId, 3600, { verifiable: true, grounding, tribunal });
    }

    const responseSignature = crypto.createHmac('sha256', process.env.IMMUNE_SECRET || 'fallback').update(finalContent).digest('hex');

    return { content: finalContent, attestation: { verifiable: true, grounding, tribunal, signature: responseSignature } };
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
