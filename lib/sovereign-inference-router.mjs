import { sovereignFirewall } from './sovereign-firewall.mjs';
import { SovereignValidator } from './sovereign-validator.mjs';
import { SovereignOrchestrator } from './sovereign-orchestrator.mjs';
import { SovereignAuditor } from './sovereign-auditor.mjs';
import { sanitizeOutput } from './inference.js';
import { piiRedactor } from './pii-redactor.js';
import { sovereignProtocol } from './sovereign-protocol.js';
import crypto from 'crypto';

export async function handleSovereignInference(req, res) {
  const requestId = crypto.randomBytes(16).toString('hex');
  const startTime = Date.now();

  // 1. المصادقة والتحقق
  const auth = await SovereignValidator.authenticate(req, res);
  if (!auth) return;

  try {
    const rawPrompt = req.body?.prompt;
    if (!rawPrompt || typeof rawPrompt !== 'string' || rawPrompt.length > 32000) {
      return res.status(400).json({ error: 'Invalid prompt', request_id: requestId });
    }

    // 2. التعقيم السيادي (PII Tokenization) - يحدث قبل أي معالجة لضمان عدم تسرب PII
    const { sanitizedText: tokenizedPrompt, mapping: piiMapping } = piiRedactor.redact(rawPrompt);

    // 3. التحقق الأمني (على النص المُعقم)
    const { sanitized, flags } = SovereignValidator.sanitizePrompt(tokenizedPrompt);
    const { threatScore, isCritical } = SovereignValidator.analyzeThreat(sanitized);

    // 4. جدار الاحتواء التلقائي (SovereignFirewall)
    const firewallResponse = await sovereignFirewall.analyzeAndAct({
      requestId,
      sessionId: req.body.session_id,
      customerId: req.customer_id || null,
      threatScore,
      metadata: { endpoint: '/api/inference', prompt_preview: sanitized.substring(0, 50) }
    });

    if (firewallResponse.action === 'block' || firewallResponse.action === 'restrict') {
      return res.status(firewallResponse.status).json({
        error: firewallResponse.message,
        request_id: requestId
      });
    }

    // 5. تنفيذ بروتوكول الاستدلال السيادي (SIP/1.0)
    // البروتوكول يتولى: الاستدلال، الإجماع ثنائي النموذج، إعادة تركيب PII
    const sipResult = await sovereignProtocol.execute(sanitized, req.body?.task_type || 'general', req.customer_id || 'global');
    const finalContent = sanitizeOutput(sipResult.content);

    // 7. التدقيق والتسجيل
    await SovereignAuditor.logSuccess({
      request_id: requestId,
      prompt_hash: crypto.createHash('sha256').update(sanitized).digest('hex'),
      created_at: new Date().toISOString()
    }, { content: finalContent, model: sipResult.attestation.chain[2].data.primary_model }, {}, {}).catch(() => {});

    // 8. شهادة الأمان مأخوذة من بروتوكول SIP

    // 9. الرد النهائي مع شهادة الأمان
    res.json({
      success: true,
      content: finalContent,
      model: sipResult.attestation.chain.length > 2 ? sipResult.attestation.chain[2].data.primary_model : (sipResult.attestation.cached ? 'hot_memory' : 'unknown'),
      latency_ms: Date.now() - startTime,
      request_id: requestId,
      pii_flags: flags,
      firewall_action: firewallResponse.action,
      sovereign_attestation: sipResult.attestation // سلسلة الإثبات التشفيرية
    });

  } catch (error) {
    console.error(`[SOVEREIGN INFERENCE] Error: ${error.message}\nStack: ${error.stack}`);
    await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, error).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal processing error', request_id: requestId });
    }
  }
}
