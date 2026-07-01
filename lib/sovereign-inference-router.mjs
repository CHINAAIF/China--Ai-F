import { sovereignFirewall } from './sovereign-firewall.mjs';
// TRUNKIA - Sovereign Inference Router - with Firewall
import { SovereignValidator } from './sovereign-validator.mjs';
import { SovereignOrchestrator } from './sovereign-orchestrator.mjs';
import { SovereignAuditor } from './sovereign-auditor.mjs';
import { SovereignFirewall } from './sovereign-firewall.mjs';
import { sanitizeOutput } from './inference.js';
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

    const { sanitized, flags } = SovereignValidator.sanitizePrompt(rawPrompt);
    const { threatScore, isCritical } = SovereignValidator.analyzeThreat(sanitized);

    // 2. جدار الاحتواء التلقائي (SovereignFirewall)
    const firewallResponse = await sovereignFirewall.analyzeAndAct({
      requestId,
      sessionId: req.body.session_id,
      customerId: req.customer_id || null,
      threatScore,
      metadata: { endpoint: '/api/inference', prompt_preview: sanitized.substring(0, 50) }
    });

    // إذا قرر الجدار حظر الطلب أو تقييده، نرسل رده فوراً
    if (firewallResponse.action === 'block' || firewallResponse.action === 'restrict') {
      return res.status(firewallResponse.status).json({
        error: firewallResponse.message,
        request_id: requestId
      });
    }

    // 3. التوجيه والتنفيذ (Orchestrator)
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

    // 4. تعقيم المخرجات
    const safeContent = sanitizeOutput(result.inference.content);

    // 5. التدقيق والتسجيل
    await SovereignAuditor.logSuccess({
      request_id: requestId,
      prompt_hash: crypto.createHash('sha256').update(sanitized).digest('hex'),
      created_at: new Date().toISOString()
    }, { ...result.inference, content: safeContent }, result.routing, result.policyDecision).catch(() => {});

    // 6. الرد النهائي
    res.json({
      success: true,
      content: safeContent,
      model: result.inference.model,
      provider: result.routing.provider?.name,
      latency_ms: Date.now() - startTime,
      request_id: requestId,
      pii_flags: flags,
      firewall_action: firewallResponse.action
    });

  } catch (error) {
    console.error(`[SOVEREIGN INFERENCE] Error: ${error.message}
Stack: ${error.stack}`);
    await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, error).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal processing error', request_id: requestId });
    }
  }
}
