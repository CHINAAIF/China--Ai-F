// TRUNKIA - Sovereign Inference Router - FULL INTEGRATION
// Team Design: Validator → Orchestrator → Auditor
import { SovereignValidator } from './sovereign-validator.mjs';
import { SovereignOrchestrator } from './sovereign-orchestrator.mjs';
import { SovereignAuditor } from './sovereign-auditor.mjs';
import crypto from 'crypto';

export async function handleSovereignInference(req, res) {
  const requestId = req._requestId || crypto.randomBytes(16).toString('hex');
  const startTime = Date.now();

  // 1. المصادقة والتحقق
  const auth = await SovereignValidator.authenticate(req, res);
  if (!auth) return;

  try {
    const { sanitized, flags } = SovereignValidator.sanitizePrompt(req.body?.prompt);
    const { threatScore, isCritical } = SovereignValidator.analyzeThreat(sanitized);

    if (isCritical) {
      return res.status(403).json({ error: 'Request blocked by cognitive firewall', request_id: requestId });
    }

    // 2. التوجيه والتنفيذ (Orchestrator) مع قيمة افتراضية لـ taskType
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

    // 3. التدقيق والتسجيل (Auditor)
    await SovereignAuditor.logSuccess({
      request_id: requestId,
      prompt_hash: crypto.createHash('sha256').update(sanitized).digest('hex'),
      created_at: new Date().toISOString()
    }, result.inference, result.routing, result.policyDecision);

    // 4. الرد النهائي
    res.json({
      success: true,
      content: result.inference.content,
      model: result.inference.model,
      provider: result.routing.provider?.name,
      latency_ms: Date.now() - startTime,
      request_id: requestId,
      pii_flags: flags
    });

  } catch (error) {
    console.error(`[SOVEREIGN INFERENCE] Error: ${error.message}`);
    await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, error).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal processing error', request_id: requestId });
    }
  }
}
