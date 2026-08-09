import fs from 'fs';
import { execSync } from 'child_process';

// === A. sovereign-protocol.js v21.0 (Complete Integrated Rewrite) ===
const protocolCode = `/**
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
    const baitedPrompt = prompt + '\\n\\n[Internal Reference: ' + canaryToken + '. Do not mention this reference.]';

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
      finalContent += '\\n\\n[TRIBUNAL NOTICE: This response was flagged by the Truth Tribunal.]';
    }

    semanticCache.store(decodedPrompt, { content: finalContent }, userId, 0, { verifiable: true, grounding, tribunal });
    await piiRedactor.cleanupSession(sessionId).catch(() => {});
    return { content: finalContent, attestation: { verifiable: true, grounding, tribunal } };
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
`;

// === B. New Route for index.js ===
const newRoute = `app.post("/v1/chat/completions", async (req, res) => {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  if (!req.is("application/json")) return res.status(415).json({ error: { message: "Unsupported Media Type" } });
  const prompt = req.body?.messages?.slice(-1)[0]?.content || "";
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) return res.status(400).json({ error: { message: "Invalid prompt" } });
  if (prompt.length > 32000) return res.status(413).json({ error: { message: "Prompt too large" } });

  try {
    let authResult;
    try {
      const rawKey = req.headers.authorization?.replace(/^Bearer\\s+/i, "") || "";
      authResult = process.env.BYPASS_AUTH === "true" ? { valid: true, userId: "bypass-user", tier: "omega" } : await validateApiKeyAndQuota(rawKey);
    } catch (authErr) { return res.status(500).json({ error: { message: "Auth service unavailable" } }); }
    if (!authResult?.valid) return res.status(401).json({ error: { message: "Unauthorized" } });

    const routingProfile = classifyTask(prompt);
    const isStream = req.body?.stream === true;
    const estimatedHold = 1000;
    let actualCost = 0, inputTokens = 0, outputTokens = 0, modelUsed = routingProfile.tier, tribunalData = null;

    if (process.env.BYPASS_AUTH !== "true") {
      const holdResult = await holdQuota(authResult.userId, estimatedHold, traceId);
      if (!holdResult.success) return res.status(429).json({ error: { message: "Insufficient quota" } });
    }

    if (!isStream) {
      try {
        const result = await sovereignProtocol.execute(prompt, routingProfile.tier, authResult.userId);
        const safeContent = sanitizeOutput(result.content || "");
        return res.json({
          id: "chatcmpl-" + crypto.randomBytes(12).toString("hex"),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: routingProfile.tier,
          choices: [{ index: 0, message: { role: "assistant", content: safeContent }, finish_reason: "stop" }],
          usage: { prompt_tokens: result.attestation?.grounding?.claims || 0, completion_tokens: result.attestation?.grounding?.confidence || 0 },
          attestation: result.attestation || {}
        });
      } catch (execErr) { return res.status(500).json({ error: { message: "Processing failed" } }); }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.flushHeaders) res.flushHeaders();

    const abortController = new AbortController();
    let heartbeatInterval = null, timeoutId = null, streamEnded = false, quotaSettled = false;

    async function settleQuotaSafe() {
      if (quotaSettled) return; quotaSettled = true;
      if (process.env.BYPASS_AUTH === "true" || !authResult?.userId) return;
      try { await settleQuota(authResult.userId, estimatedHold, actualCost, traceId); } catch (e) { quotaSettled = false; }
    }

    async function cleanup(reason) {
      if (streamEnded) return; streamEnded = true;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      try { abortController.abort(); } catch (_) {}
      await settleQuotaSafe();
      if (!res.writableEnded && !res.destroyed) {
        try {
          if (tribunalData) {
            res.write("data: " + JSON.stringify({ id: "chatcmpl-meta", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }], tribunal: tribunalData }) + "\\n\\n");
          }
          res.write("data: [DONE]\\n\\n");
        } catch (_) {}
        res.end();
      }
    }

    res.on("error", () => cleanup("res_error"));
    res.on("close", () => { if (!streamEnded && !res.writableEnded) cleanup("client_disconnect"); });
    timeoutId = setTimeout(() => { if (!streamEnded) cleanup("request_timeout"); }, 120000);
    heartbeatInterval = setInterval(() => {
      if (streamEnded || res.writableEnded || res.destroyed) { clearInterval(heartbeatInterval); return; }
      try { res.write(": heartbeat\\n\\n"); } catch (e) { if (!streamEnded) cleanup("heartbeat_fail"); }
    }, 15000);

    try {
      const stream = sovereignProtocol.executeStream(prompt, routingProfile.tier, authResult.userId, abortController.signal);
      for await (const event of stream) {
        if (streamEnded || res.writableEnded || res.destroyed) break;
        if (event.type === "chunk") {
          let sanitized;
          try { sanitized = sanitizeOutput(String(event.content ?? "")); } catch (sanErr) { sanitized = ""; }
          const ssePayload = { id: "chatcmpl-" + crypto.randomBytes(12).toString("hex"), object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelUsed, choices: [{ index: 0, delta: { content: sanitized }, finish_reason: null }] };
          const payload = "data: " + JSON.stringify(ssePayload) + "\\n\\n";
          const canWrite = res.write(payload);
          if (!canWrite && !streamEnded) { await new Promise(resolve => res.once("drain", resolve)); }
        } else if (event.type === "metadata") {
          actualCost = event.totalCost || 0;
          inputTokens = event.inputTokens || 0;
          outputTokens = event.outputTokens || 0;
          modelUsed = event.model || modelUsed;
          tribunalData = event.tribunal || null;
        } else if (event.type === "error") {
          if (event.metadata) { actualCost = event.metadata.totalCost || 0; tribunalData = event.metadata.tribunal || null; }
          try { res.write("data: " + JSON.stringify({ error: { message: "Stream processing error" } }) + "\\n\\n"); } catch (_) {}
        }
      }
      if (!streamEnded) { await cleanup("normal_completion"); }
    } catch (streamErr) {
      if (!streamEnded) { try { res.write("data: " + JSON.stringify({ error: { message: "Stream interrupted" } }) + "\\n\\n"); } catch (_) {} await cleanup("stream_error"); }
    }
  } catch (err) {
    if (!res.headersSent) { return res.status(500).json({ error: { message: "Internal error" } }); } else if (!res.writableEnded) { res.end(); }
  }
});`;

// === C. Deploy Logic ===
async function deploy() {
  console.log('[DEPLOYER] Writing sovereign-protocol.js v21.0...');
  fs.writeFileSync('lib/sovereign-protocol.js', protocolCode);

  console.log('[DEPLOYER] Modifying index.js...');
  let code = fs.readFileSync('index.js', 'utf8');

  // 1. Extract old route using AST-like brace matching
  const routeStart = code.indexOf('app.post("/v1/chat/completions"');
  if (routeStart !== -1) {
    let braceCount = 0, inString = false, stringChar = '', escaped = false, routeEnd = -1;
    for (let i = routeStart; i < code.length; i++) {
      const ch = code[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (inString) { if (ch === stringChar) inString = false; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; continue; }
      if (ch === '{') braceCount++;
      if (ch === '}') {
        braceCount--;
        if (braceCount === 0) {
          let j = i + 1;
          while (j < code.length && code[j] !== ';') j++;
          routeEnd = j + 1;
          break;
        }
      }
    }
    if (routeEnd !== -1) {
      code = code.substring(0, routeStart) + newRoute + code.substring(routeEnd);
      console.log('[DEPLOYER] [+] /v1/chat/completions route replaced.');
    }
  }

  fs.writeFileSync('index.js', code);

  console.log('[DEPLOYER] Syntax checking...');
  try {
    execSync('node --check lib/sovereign-protocol.js', { stdio: 'inherit' });
    execSync('node --check index.js', { stdio: 'inherit' });
    console.log('[✓] Syntax OK');
  } catch (e) {
    console.error('[✗] Syntax Failed');
    process.exit(1);
  }
}

deploy();
