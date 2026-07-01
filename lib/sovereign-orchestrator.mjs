// lib/sovereign-orchestrator.mjs
// العقليات: مهندس البنية التحتية، خبير في الذكاء الاصطناعي، مهندس برمجيات
import { multiModel } from '../agents/governance/multi-model.js';
import { tacticalRouter } from '../agents/governance/tactical-routing.js';
import { policyEnforcer } from '../agents/governance/policy-enforcer.js';

export class SovereignOrchestrator {
    static async execute({ sanitized, taskType, customerId, sessionId, preferences, threatScore }) {
        // 1. تطبيق سياسة الحوكمة
        const policyDecision = await policyEnforcer.enforce({
            customer_id: customerId,
            action: 'inference',
            resource: taskType,
            context: { threat_score: threatScore }
        });
        if (!policyDecision.allowed) {
            throw new Error(`Policy blocked: ${policyDecision.reason}`);
        }

        // 2. التوجيه الذكي
        const routing = await tacticalRouter.route({
            task_type: taskType,
            budget_usd: preferences?.budget,
            required_residency: preferences?.data_residency,
            prefer_open: preferences?.prefer_open,
            customer_id: customerId,
            policy_version_id: policyDecision.policy_version_id
        });

        if (!routing?.success) {
            throw new Error('No suitable provider available');
        }

        // 3. الاستدلال
        const useConsensus = preferences?.consensus || threatScore > 0.65;
        let inference;
        if (useConsensus) {
            const result = await multiModel.runConsensus(sanitized);
            inference = result?.responses?.groq; // النموذج الرئيسي
        } else {
            inference = await multiModel.runSingle(taskType, sanitized);
        }

        if (!inference?.approved) {
            throw new Error(`Inference failed: ${inference?.error}`);
        }

        return { inference, routing, policyDecision };
    }
}
