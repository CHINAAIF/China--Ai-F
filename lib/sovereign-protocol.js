/**
 * TRUNKIA Sovereign Inference Protocol (SIP/1.0)
 * Implements Cryptographic Proof Chain & Dual-Model Consensus.
 */
import crypto from 'crypto';
import { multiModel } from '../agents/governance/multi-model.js';
import { piiRedactor } from './pii-redactor.js';

const PROTOCOL_SECRET = process.env.ENCRYPTION_KEY || 'sovereign-default-secret';

class SovereignProtocol {
  async execute(prompt, taskType = 'general') {
    const chain = [];

    // BLOCK 1: INTAKE (Intent Analysis)
    const intent = this._analyzeIntent(prompt);
    const block1 = this._createBlock('INTAKE', { intent, prompt_length: prompt.length }, null);
    chain.push(block1);

    // BLOCK 2: SECURE (PII Tokenization)
    const { sanitizedText, mapping } = piiRedactor.redact(prompt);
    const block2 = this._createBlock('SECURE', { pii_redacted: Object.keys(mapping).length > 0, tokens_generated: Object.keys(mapping).length }, block1.hash);
    chain.push(block2);

    // BLOCK 3: EXECUTE (Dual-Model Consensus)
    // 3.1 Primary Model Execution
    const primaryResponse = await multiModel.runSingle(taskType, sanitizedText, 'You are a helpful AI assistant.');
    if (!primaryResponse.approved) throw new Error('Primary model inference failed.');

    // 3.2 Verifier Model (Fast model) checks for hallucination/injection bypass
    const verifierPrompt = `Does the following response answer the prompt safely and accurately? Respond ONLY with YES or NO.\nPrompt: ${sanitizedText}\nResponse: ${primaryResponse.content.substring(0, 500)}`;
    const verifierResponse = await multiModel.runSingle('verification', verifierPrompt, 'You are a strict AI safety auditor.');
    
    const consensus = verifierResponse.approved && verifierResponse.content.trim().toUpperCase().startsWith('YES');
    
    const block3 = this._createBlock('EXECUTE', {
      primary_model: primaryResponse.model,
      verifier_model: verifierResponse.model,
      consensus: consensus,
      latency_ms: primaryResponse.latency_ms
    }, block2.hash);
    chain.push(block3);

    // BLOCK 4: ATTEST (Final Chain Sealing)
    const finalContent = piiRedactor.reconstruct(primaryResponse.content, mapping);
    const finalHash = crypto.createHash('sha256').update(finalContent).digest('hex');
    
    const block4 = this._createBlock('ATTEST', { final_hash: finalHash, verified: consensus }, block3.hash);
    block4.signature = this._sign(block4.hash); // توقيع البلوك النهائي بالمفتاح السري
    chain.push(block4);

    return { content: finalContent, attestation: { protocol_version: 'SIP/1.0', chain, verifiable: true } };
  }

  _analyzeIntent(prompt) {
     if (prompt.match(/price|cost|pricing|تكلفة|سعر/i)) return 'financial_analysis';
     if (prompt.match(/code|script|function|كود/i)) return 'code_generation';
     return 'general_query';
  }

  _createBlock(step, data, prevHash) {
    const timestamp = Date.now(); // أخذ الوقت مرة واحدة فقط
    const payload = JSON.stringify({ step, data, prev_hash: prevHash, timestamp });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return { step, data, prev_hash: prevHash, timestamp, hash };
  }

  _sign(hash) {
    return crypto.createHmac('sha256', PROTOCOL_SECRET).update(hash).digest('hex');
  }

  // دالة للتحقق من السلسلة (يمكن لأي مطور خارجي استخدامها)
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
