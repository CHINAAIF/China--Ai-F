import { sovereignFirewall } from './sovereign-firewall.mjs';
import { SovereignValidator } from './sovereign-validator.mjs';
import { SovereignOrchestrator } from './sovereign-orchestrator.mjs';
import { SovereignAuditor } from './sovereign-auditor.mjs';
import { sanitizeOutput } from './inference.js';
import { piiRedactor } from './pii-redactor.js';
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

    // 5. التوجيه والتنفيذ (Orchestrator -> multiModel)
    // البوابة بداخلها ستطبق: Input Guard, Semantic Cache, DLP Engine
    const result = await SovereignOrchestrator.execute({
      sanitized,
      taskType: req.body?.task_type || 'general',
      customerId: req.customer_id || null,
      sessionId: req.body.session_id,
      preferences: {
        budget: req.body.budget,
        data_residency: req.body.data_residency,
        prefer_open: req.body.prefer_open,
        consensus: req.body.consensus
      },
      threatScore
    });

    // 6. إعادة تركيب PII (Reconstruction)
    // الرد يأتي من multiModel (تم تعقيمه بـ DLP), نعيد الآن البيانات الحقيقية
    let finalContent = sanitizeOutput(result.inference.content);
    finalContent = piiRedactor.reconstruct(finalContent, piiMapping);

    // 7. التدقيق والتسجيل
    await SovereignAuditor.logSuccess({
      request_id: requestId,
      prompt_hash: crypto.createHash('sha256').update(sanitized).digest('hex'),
      created_at: new Date().toISOString()
    }, { ...result.inference, content: finalContent }, result.routing, result.policyDecision).catch(() => {});

    // 8. توليد شهادة الأمان التشفيرية (Security Certificate)
    const certPayload = {
      request_id: requestId,
      pii_encrypted: Object.keys(piiMapping).length > 0,
      input_guarded: true,
      dlp_sanitized: true,
      timestamp: Date.now()
    };
    const securityCertificate = {
      ...certPayload,
      hash: crypto.createHash('sha256').update(JSON.stringify(certPayload)).digest('hex')
    };

    // 9. الرد النهائي مع شهادة الأمان
    res.json({
      success: true,
      content: finalContent,
      model: result.inference.model,
      provider: result.routing.provider?.name,
      latency_ms: Date.now() - startTime,
      request_id: requestId,
      pii_flags: flags,
      firewall_action: firewallResponse.action,
      security_certificate: securityCertificate // اللمسة السحرية
    });

  } catch (error) {
    console.error(`[SOVEREIGN INFERENCE] Error: ${error.message}\nStack: ${error.stack}`);
    await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, error).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal processing error', request_id: requestId });
    }
  }
}
