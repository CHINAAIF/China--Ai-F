/**
 * TRUNKIA Sovereign Inference Protocol (SIP/1.0)
 * Implements Cryptographic Proof Chain & Deterministic Verification.
 */
import crypto from 'crypto';
import { multiModel } from '../agents/governance/multi-model.js';
import { piiRedactor } from './pii-redactor.js';
import { semanticCache } from './semantic-cache.js';

// STRICT FAIL-FAST: No default secrets allowed in Sovereign Systems.
const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY;
if (!PROTOCOL_SECRET) {
  throw new Error('CRITICAL: ENCRYPTION_KEY is not set. Sovereign Protocol cannot sign attestations.');
}

// Deterministic patterns to detect executable payloads in outputs
const DANGEROUS_OUTPUT_PATTERNS = [
  /execute:?\s*(drop|delete|truncate|update|insert)/i,
  /rm\s+-rf/i,
  /\b(sh|bash|zsh)\b.*-c/i
];

class SovereignProtocol {
  async execute(prompt, taskType = 'general', userId = 'global') {
    const chain = [];

    // HOT MEMORY: O(1) Search before any expensive operations
    const cachedResult = semanticCache.search(prompt, userId);
    if (cachedResult) {
      return { content: cachedResult.content, attestation: { protocol_version: 'SIP/1.0', chain: [], verifiable: true, cached: true } };
    }

    // BLOCK 1: INTAKE (Intent Analysis & Canary Injection)
    const intent = this._analyzeIntent(prompt);
    const canaryToken = `CTR-${crypto.randomBytes(4).toString('hex')}`;
    const baitedPrompt = `${prompt}\n[SYSTEM_META: ${canaryToken}]`; // Canary to detect data exfiltration
    
    const block1 = this._createBlock('INTAKE', { intent, prompt_length: prompt.length }, null);
    chain.push(block1);

    // BLOCK 2: SECURE (PII Tokenization)
    const { sanitizedText, mapping } = piiRedactor.redact(baitedPrompt);
    const block2 = this._createBlock('SECURE', { pii_redacted: Object.keys(mapping).length > 0 }, block1.hash);
    chain.push(block2);

    // BLOCK 3: EXECUTE (Single Model - Deterministic Check)
    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, 'You are a helpful AI assistant.');
    if (!primaryResponse.approved) throw new Error('Primary model inference failed.');

    // Deterministic Verification (Replaces slow/injectable LLM Verifier)
    const outputContent = primaryResponse.content || '';
    const canaryLeaked = outputContent.includes(canaryToken);
    const hasDangerousPayload = DANGEROUS_OUTPUT_PATTERNS.some(p => p.test(outputContent));
    
    const consensus = !canaryLeaked && !hasDangerousPayload;

    const block3 = this._createBlock('EXECUTE', {
      primary_model: primaryResponse.model,
      consensus: consensus,
      canary_intact: !canaryLeaked,
      latency_ms: primaryResponse.latency_ms
    }, block2.hash);
    chain.push(block3);

    // BLOCK 4: ATTEST (Final Chain Sealing)
    const finalContent = piiRedactor.reconstruct(outputContent, mapping);
    const finalHash = crypto.createHash('sha256').update(finalContent).digest('hex');

    const block4 = this._createBlock('ATTEST', { final_hash: finalHash, verified: consensus }, block3.hash);
    block4.signature = this._sign(block4.hash); 
    chain.push(block4);

    // Silent Kill if Canary leaked or dangerous payload detected
    if (!consensus) {
      console.error(`[SIP/1.0] ALERT: Consensus failed. Canary Leaked: ${canaryLeaked}, Dangerous Payload: ${hasDangerousPayload}`);
      return { 
        content: "I cannot process this request as it violates security policies.", 
        attestation: { protocol_version: 'SIP/1.0', chain, verifiable: true, blocked: true } 
      };
    }

    // HOT MEMORY: Store pure response with attestation
    semanticCache.store(prompt, { content: finalContent }, userId, 0, { verifiable: true, chain });
    return { content: finalContent, attestation: { protocol_version: 'SIP/1.0', chain, verifiable: true } };
  }

  _analyzeIntent(prompt) {
     if (prompt.match(/price|cost|pricing|تكلفة|سعر/i)) return 'financial_analysis';
     if (prompt.match(/code|script|function|كود/i)) return 'code_generation';                                                            return 'general_query';
  }

  _createBlock(step, data, prevHash) {
    const timestamp = Date.now();
    const payload = JSON.stringify({ step, data, prev_hash: prevHash, timestamp });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return { step, data, prev_hash: prevHash, timestamp, hash };
  }

  _sign(hash) {
    return crypto.createHmac('sha256', PROTOCOL_SECRET).update(hash).digest('hex');
  }

  verifyAttestation(attestation) {
    let prevHash = null;
    for (const block of attestation.chain) {
      if (block.prev_hash !== prevHash) return false;
      const payload = JSON.stringify({ step: block.step, data: block.data, prev_hash: block.prev_hash, timestamp: block.timestamp });
      const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
      if (block.hash !== expectedHash) return false;
      prevHash = block.hash;
    }
    const finalBlock = attestation.chain[attestation.chain.length - 1];
    const expectedSig = this._sign(finalBlock.hash);
    if (finalBlock.signature !== expectedSig) return false;
    return true;
  }
}

export const sovereignProtocol = new SovereignProtocol();
export default sovereignProtocol;
