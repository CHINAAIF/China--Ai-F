// lib/sovereign-auditor.mjs
// العقليات: مهندس قواعد البيانات، خبير في التدقيق والامتثال
import { logInferenceAsync, logCognitiveTurn } from './inference.js';
import crypto from 'crypto';

export class SovereignAuditor {
    static async logSuccess(logEntry, inferenceResult, routingResult, policyDecision) {
        await logInferenceAsync({
            ...logEntry,
            success: true,
            model: inferenceResult.model,
            tokens: inferenceResult.tokens,
            latency_ms: Date.now() - (new Date(logEntry.created_at).getTime()),
            policy_version_id: policyDecision.policy_version_id,
            routing_id: routingResult.routing_id
        });
    }

    static async logFailure(logEntry, error) {
        await logInferenceAsync({
            ...logEntry,
            success: false,
            error: error.message,
            latency_ms: Date.now() - (new Date(logEntry.created_at).getTime())
        }).catch(() => {});
    }
}
