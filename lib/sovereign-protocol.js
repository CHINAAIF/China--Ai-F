/**
 * TRUNKIA Sovereign Protocol v21.0 (Omega Protocol - Global Enterprise Edition)
 * Complete Rewrite: Deep Decoder, PII Vault, Mid-Stream Failover, Truth Tribunal.
 */
import crypto from 'crypto';
import { piiRedactor } from './pii-redactor.js';
import { getRoutingChain } from './sovereign-router.mjs';
import { groundingEngine } from './services/grounding-engine.js';
import { deepDecode } from './services/deep-decoder.js';
import { truthTribunal } from './services/truth-tribunal.js';
import OpenAI from 'openai';
import { multiModel } from '../agents/governance/multi-model.js';
import { semanticCache } from './semantic-cache.js';

const estimateTokens = (text) => {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
};

class SovereignProtocol {
  static TASK_CONFIG = {
    general: { maxTokens: 2048, temperature: 0.3, systemPrompt: 'You are TRUNKIA Sovereign Intelligence Core. Respond with precision.' },
    financial: { maxTokens: 4096, temperature: 0.1, systemPrompt: 'You are TRUNKIA Financial Intelligence. Extreme precision. No speculation.' },
    coding: { maxTokens: 8192, temperature: 0.2, systemPrompt: 'You are TRUNKIA Code Sovereign. Generate clean, secure code.' },
    analysis: { maxTokens: 4096, temperature: 0.4, systemPrompt: 'You are TRUNKIA Analytical Engine. Provide structured analysis.' }
  };

  async *executeStream(prompt, taskType = 'general', userId = 'global', abortSignal = null) {
    const sessionId = crypto.randomUUID();
    const canaryId = crypto.randomBytes(4).toString('hex');
    const canaryToken = 'REF-' + canaryId;
    const baitedPrompt = prompt + '\n\n[Internal Reference: ' + canaryToken + '. Do not mention this reference.]';

    const promptDecode = deepDecode(baitedPrompt);
    if (promptDecode.rejected) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Obfuscated input rejected.', metadata: { reason: promptDecode.reason } };
      return;
    }
    const decodedPrompt = promptDecode.decoded;

    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const inputTokens = estimateTokens(sanitizedText);

    let chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      chain = [{ providerName: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, modelName: 'llama-3.1-8b-instant' }];
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    let outputTokens = 0, canaryLeaked = false, modelUsed = 'unknown', providerAttempted = 0, providerSucceeded = false;
    let rollingContext = '', fullTextForGrounding = '';

    for (const provider of chain) {
      providerAttempted++;
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
            fullTextForGrounding += content;
            rollingContext = (rollingContext + content).slice(-150);
            outputTokens += estimateTokens(content);
            if ((residual + buffer).includes(canaryToken)) { canaryLeaked = true; break; }
            if ((buffer.length >= 15 && buffer.lastIndexOf('[') <= buffer.lastIndexOf(']')) || finishReason) {
              const reconstructed = recon.process(buffer);
              if (reconstructed) yield { type: 'chunk', content: reconstructed };
              residual = buffer.slice(-(canaryToken.length - 1));
              buffer = '';
            }
          }
        }
        if (buffer.length > 0 && !canaryLeaked) { const r = recon.process(buffer); if (r) yield { type: 'chunk', content: r }; }
        const finalFlush = recon.flush();
        if (finalFlush) yield { type: 'chunk', content: finalFlush };
        if (canaryLeaked) break;
        if (providerYielded || outputTokens > 0) { providerSucceeded = true; break; }
      } catch (e) {
        if (e.name === 'AbortError' && abortSignal?.aborted) break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const groundingResult = groundingEngine.ground(fullTextForGrounding);
    const tribunalResult = await truthTribunal.verify(decodedPrompt, fullTextForGrounding, taskType, groundingResult);
    const actualCost = inputTokens + outputTokens;
    
    yield { 
      type: 'metadata', 
      inputTokens, 
      outputTokens, 
      totalCost: actualCost, 
      model: modelUsed, 
      providersAttempted: providerAttempted, 
      providerSucceeded, 
      canaryLeaked,
      grounding: groundingResult,
      tribunal: tribunalResult
    };

    await piiRedactor.cleanupSession(sessionId).catch(() => {});
  }

  async execute(prompt, taskType = 'general', userId = 'global') {
    const sessionId = crypto.randomUUID();
    const promptDecode = deepDecode(prompt);
    if (promptDecode.rejected) throw new Error('Obfuscated input rejected');
    const decodedPrompt = promptDecode.decoded;

    const cachedResult = semanticCache.search(decodedPrompt, userId);
    if (cachedResult) {
      const grounding = groundingEngine.ground(cachedResult.content);
      const tribunal = await truthTribunal.verify(decodedPrompt, cachedResult.content, taskType, grounding);
      return { content: cachedResult.content, attestation: { verifiable: true, cached: true, grounding, tribunal } };
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, config.systemPrompt);
    if (!primaryResponse.approved) throw new Error('Inference rejected');
    let finalContent = await piiRedactor.reconstruct(primaryResponse.content, sessionId, mapping);
    
    const grounding = groundingEngine.ground(finalContent);
    const tribunal = await truthTribunal.verify(decodedPrompt, finalContent, taskType, grounding);
    if (!tribunal.verdict === 'ACCEPTED') {
      finalContent += '\n\n[TRIBUNAL NOTICE: This response was flagged by the Truth Tribunal.]';
    }

    semanticCache.store(decodedPrompt, { content: finalContent }, userId, 0, { verifiable: true, grounding, tribunal });
    await piiRedactor.cleanupSession(sessionId).catch(() => {});
    return { content: finalContent, attestation: { verifiable: true, grounding, tribunal } };
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
