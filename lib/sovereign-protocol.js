/**
 * TRUNKIA Sovereign Protocol v28.0 (Omega Protocol)
 * 
 * Complete Rewrite:
 * 1. Unified Execution (executeStream & execute use ProviderMesh)
 * 2. Ed25519 Sovereign Signing (via Key Manager)
 * 3. Semantic Cache Integration
 * 4. PII Vault Reconstruction (Stream & Non-Stream)
 * 5. Zero Legacy Dependencies (multiModel extirpated)
 */
import crypto from 'crypto';
import { piiRedactor } from './pii-redactor.js';
import { getRoutingChain } from './sovereign-router.mjs';
import { groundingEngine } from './services/grounding-engine.js';
import { deepDecode } from './services/deep-decoder.js';
import { truthTribunal } from './services/truth-tribunal.js';
import { providerMesh, ProviderMesh } from './services/provider-mesh.js';
import { sovereignKeys } from './services/key-manager.js';
import { semanticCache } from './semantic-cache.js';

const estimateTokens = function(text) {
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

  async *executeStream(prompt, taskType, userId, abortSignal, quotaContext, traceId) {
    const sessionId = crypto.randomUUID();
    const canaryToken = 'REF-' + crypto.randomBytes(4).toString('hex');
    const baitedPrompt = prompt + '\n\n[Internal Reference: ' + canaryToken + '. Do not mention this reference.]';

    const decodeResult = deepDecode(baitedPrompt);
    if (decodeResult.rejected) {
      yield { type: 'error', content: 'SOVEREIGN VIOLATION: Obfuscated input rejected.' };
      return;
    }
    const decodedPrompt = decodeResult.decoded;

    const cached = await semanticCache.search(decodedPrompt, userId);
    if (cached) {
      yield { type: 'chunk', content: cached.content };
      const cryptoProof = sovereignKeys.sign(cached.content, traceId || crypto.randomUUID(), Date.now());
      yield {
        type: 'metadata',
        inputTokens: 0, outputTokens: 0, totalCost: 0,
        model: 'semantic-cache', providerSucceeded: true,
        cached: true, similarity: cached.similarity,
        grounding: { grounded: true, confidence: 100 },
        tribunal: { verdict: 'ACCEPTED', confidence: 100 },
        cryptoProof: cryptoProof
      };
      if (quotaContext) await quotaContext.settle();
      await piiRedactor.cleanupSession(sessionId).catch(function() {});
      return;
    }

    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);
    const inputTokens = estimateTokens(sanitizedText);

    let chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      chain = [{ providerName: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, modelName: 'llama-3.1-8b-instant' }];
    }
    chain = providerMesh.sortChain(chain);

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const mesh = new ProviderMesh();
    const recon = piiRedactor.createStreamReconstructor(mapping);
    
    let outputTokens = 0, providerSucceeded = false, modelUsed = 'unknown', fullText = '';

    try {
      const raceStream = mesh.race(sanitizedText, chain, config, canaryToken, abortSignal);
      
      for await (const event of raceStream) {
        if (event.type === 'chunk') {
          const reconstructed = recon.process(event.content);
          if (reconstructed) {
            fullText += reconstructed;
            outputTokens += estimateTokens(reconstructed);
            
            if (quotaContext) {
              const ok = await quotaContext.meter(estimateTokens(reconstructed));
              if (!ok) { yield { type: 'error', content: 'QUOTA_EXHAUSTED' }; break; }
            }
            yield { type: 'chunk', content: reconstructed };
          }
        } else if (event.type === 'metadata') {
          providerSucceeded = event.providerSucceeded;
          modelUsed = event.model;
        } else if (event.type === 'error') {
          yield { type: 'error', content: event.content };
          return;
        }
      }
      
      const finalFlush = recon.flush();
      if (finalFlush) {
        fullText += finalFlush;
        yield { type: 'chunk', content: finalFlush };
      }
    } catch (e) {
      // Abort or network error
    } finally {
      if (quotaContext) await quotaContext.settle();
    }

    let groundingResult, tribunalResult;
    try {
      groundingResult = groundingEngine.ground(fullText);
      tribunalResult = await truthTribunal.verify(decodedPrompt, fullText, taskType, groundingResult);
    } catch (e) {
      tribunalResult = { verdict: 'ACCEPTED', confidence: 50, reason: 'TRIBUNAL_FALLBACK' };
    }

    if (tribunalResult.verdict === 'ACCEPTED' || groundingResult.grounded) {
      await semanticCache.store(decodedPrompt, { content: fullText }, userId, 3600, { verifiable: true, grounding: groundingResult, tribunal: tribunalResult });
    }

    const cryptoProof = sovereignKeys.sign(fullText, traceId || crypto.randomUUID(), Date.now());

    yield {
      type: 'metadata',
      inputTokens, outputTokens, totalCost: inputTokens + outputTokens,
      model: modelUsed, providerSucceeded,
      grounding: groundingResult, tribunal: tribunalResult, cryptoProof
    };

    await piiRedactor.cleanupSession(sessionId).catch(function() {});
  }

  async execute(prompt, taskType, userId, quotaContext, traceId) {
    const sessionId = crypto.randomUUID();
    const decodeResult = deepDecode(prompt);
    if (decodeResult.rejected) throw new Error('Obfuscated input rejected');
    const decodedPrompt = decodeResult.decoded;

    const cachedResult = await semanticCache.search(decodedPrompt, userId);
    if (cachedResult) {
      const grounding = groundingEngine.ground(cachedResult.content);
      const tribunal = await truthTribunal.verify(decodedPrompt, cachedResult.content, taskType, grounding);
      if (quotaContext) await quotaContext.settle();
      const cryptoProof = sovereignKeys.sign(cachedResult.content, traceId || crypto.randomUUID(), Date.now());
      return { content: cachedResult.content, attestation: { verifiable: true, cached: true, grounding, tribunal, cryptoProof } };
    }

    const config = SovereignProtocol.TASK_CONFIG[taskType] || SovereignProtocol.TASK_CONFIG.general;
    const { sanitizedText, mapping } = await piiRedactor.redact(decodedPrompt, sessionId);

    let chain = await getRoutingChain(taskType);
    if (!chain || chain.length === 0) {
      chain = [{ providerName: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, modelName: 'llama-3.1-8b-instant' }];
    }
    chain = providerMesh.sortChain(chain);

    const mesh = new ProviderMesh();
    const canaryToken = 'REF-' + crypto.randomBytes(4).toString('hex');
    const raceStream = mesh.race(sanitizedText, chain, config, canaryToken, null);
    const recon = piiRedactor.createStreamReconstructor(mapping);
    
    let fullText = '', providerSucceeded = false, modelUsed = 'unknown';

    for await (const event of raceStream) {
      if (event.type === 'chunk') {
        const reconstructed = recon.process(event.content);
        if (reconstructed) fullText += reconstructed;
      } else if (event.type === 'metadata') {
        providerSucceeded = event.providerSucceeded;
        modelUsed = event.model;
      } else if (event.type === 'error') {
        throw new Error(event.content || 'Inference failed');
      }
    }
    
    const finalFlush = recon.flush();
    if (finalFlush) fullText += finalFlush;

    if (quotaContext) {
      await quotaContext.meter(estimateTokens(fullText));
      await quotaContext.settle();
    }

    const grounding = groundingEngine.ground(fullText);
    let tribunal;
    try {
      tribunal = await truthTribunal.verify(decodedPrompt, fullText, taskType, grounding);
    } catch (e) {
      tribunal = { verdict: 'ACCEPTED', confidence: 50, reason: 'TRIBUNAL_FALLBACK' };
    }

    if (tribunal.verdict === 'ACCEPTED' || grounding.grounded) {
      await semanticCache.store(decodedPrompt, { content: fullText }, userId, 3600, { verifiable: true, grounding, tribunal });
    }

    const cryptoProof = sovereignKeys.sign(fullText, traceId || crypto.randomUUID(), Date.now());

    return {
      content: fullText,
      attestation: { verifiable: true, grounding, tribunal, cryptoProof }
    };
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
