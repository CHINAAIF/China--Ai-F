// lib/sovereign-validator.mjs
// العقليات: مهندس أمن سيبراني، خبير في IAM، خبير في حماية المدخلات
import { sanitizeInput, analyzePromptLocally } from './inference.js';
import { validateApiKeyAndQuota } from './iam-gateway.mjs';
import crypto from 'crypto';

export class SovereignValidator {
    static async authenticate(req, res) {
        const auth = await validateApiKeyAndQuota(req, res);
        if (!auth?.valid) {
            if (!res.headersSent) res.status(401).json({ error: 'Authentication failed' });
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
