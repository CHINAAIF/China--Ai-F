// Sovereign Validator - يستقبل req ويستخرج المفتاح قبل التحقق
import { sanitizeInput, analyzePromptLocally } from './inference.js';
import { validateApiKeyAndQuota } from './iam-gateway.mjs';

export class SovereignValidator {
  static async authenticate(req, res) {
    const rawKey = req.headers['authorization']?.replace('Bearer ', '');
    const auth = await validateApiKeyAndQuota(rawKey);
    if (!auth?.valid) {
      if (!res.headersSent) res.status(auth?.code || 401).json({ error: auth?.message || 'Authentication failed' });
      return null;
    }
    return auth;
  }

  static sanitizePrompt(rawPrompt) {
    if (!rawPrompt || typeof rawPrompt !== 'string' || rawPrompt.length === 0) {
      throw new Error('Invalid prompt');
    }
    if (rawPrompt.length > 32000) {
      throw new Error('Prompt too large');
    }
    const { sanitized, flags } = sanitizeInput(rawPrompt);
    return { sanitized, flags };
  }

  static analyzeThreat(sanitized) {
    const threat = analyzePromptLocally(sanitized);
    const threatScore = threat?.injection_score || 0;
    const isCritical = threatScore > 0.85;
    return { threatScore, isCritical, details: threat };
  }
}
