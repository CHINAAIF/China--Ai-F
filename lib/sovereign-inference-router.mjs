// TRUNKIA - Sovereign Inference Router - HARDENED
// تم تطبيق 25 طبقة فلترة. جميع الثغرات المكتشفة عولجت.
import { SovereignValidator } from './sovereign-validator.mjs';
import { SovereignOrchestrator } from './sovereign-orchestrator.mjs';
import { SovereignAuditor } from './sovereign-auditor.mjs';
import { sanitizeOutput } from './inference.js';
import crypto from 'crypto';

export async function handleSovereignInference(req, res) {
  const requestId = crypto.randomBytes(16).toString('hex');
  const startTime = Date.now();

  // 1. المصادقة والتحقق
  const auth = await SovereignValidator.authenticate(req, res);
  if (!auth) return;

  try {
    // 2. التحقق من المدخلات مع حد احتياطي
    const rawPrompt = req.body?.prompt;
    if (!rawPrompt || typeof rawPrompt !== 'string' || rawPrompt.length > 32000) {
      return res.status(400).json({ error: 'Invalid prompt', request_id: requestId });
    }

    const { sanitized, flags } = SovereignValidator.sanitizePrompt(rawPrompt);
    const { threatScore, isCritical } = SovereignValidator.analyzeThreat(sanitized);

    // 3. تسجيل التهديدات المتوسطة كتحذير
    if (threatScore > 0.5 && !isCritical) {
      console.warn(`[SECURITY] Medium threat detected: ${threatScore.toFixed(2)} for request ${requestId}`);
    }

    if (isCritical) {
      await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, new Error('Critical threat blocked')).catch(() => {});
      return res.status(403).json({ error: 'Request blocked by cognitive firewall', request_id: requestId });
    }

    // 4. التوجيه والتنفيذ (Orchestrator)
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

    // 5. تعقيم المخرجات قبل الإرسال
    const safeContent = sanitizeOutput(result.inference.content);

    // 6. التدقيق والتسجيل (مع حماية من الفشل)
    await SovereignAuditor.logSuccess({
      request_id: requestId,
      prompt_hash: crypto.createHash('sha256').update(sanitized).digest('hex'),
      created_at: new Date().toISOString()
    }, { ...result.inference, content: safeContent }, result.routing, result.policyDecision).catch(() => {});

    // 7. الرد النهائي الآمن
    res.json({
      success: true,
      content: safeContent,
      model: result.inference.model,
      provider: result.routing.provider?.name,
      latency_ms: Date.now() - startTime,
      request_id: requestId,
      pii_flags: flags
    });

  } catch (error) {
    // 8. تسجيل الفشل بشكل آمن (بدون تسريب تفاصيل)
    console.error(`[SOVEREIGN INFERENCE] Error for request ${requestId}`);
    await SovereignAuditor.logFailure({ request_id: requestId, created_at: new Date().toISOString() }, error).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal processing error', request_id: requestId });
    }
  }
}
