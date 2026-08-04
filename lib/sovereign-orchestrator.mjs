// lib/sovereign-orchestrator.mjs
// العقليات: مهندس البنية التحتية، خبير في الذكاء الاصطناعي، مهندس برمجيات
import { multiModel } from '../agents/governance/multi-model.js';
import { tacticalRouter } from '../agents/governance/tactical-routing.js';
import { policyEnforcer } from '../agents/governance/policy-enforcer.js';
import { writeMemory, readMemory } from './blackboard.js';
import { constitutionEngine } from './constitution-engine.js';

export class SovereignOrchestrator {
    static async execute({ sanitized, taskType, customerId, sessionId, preferences, threatScore }) {
        
        // 0. الذاكرة المشتركة (Blackboard): قراءة السياق السابق للعميل/الجلسة
        const contextKey = `session:${sessionId}:context`;
        const previousContext = await readMemory(contextKey) || {};

        // 1. تطبيق سياسة الحوكمة
        const policyDecision = await policyEnforcer.enforce({
            customer_id: customerId,
            action: 'inference',
            resource: taskType,
            context: { threat_score: threatScore, history: previousContext }
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

        // 3. الاستدلال (إصلاح الثغرة: اختيار ديناميكي للنموذج بدلاً من تثبيت Groq)
        const useConsensus = preferences?.consensus || threatScore > 0.65;
        let inference;
        
        if (useConsensus) {
            inference = await multiModel.runConsensus(sanitized);
            if (!inference?.approved) {
                throw new Error('Consensus failed: All models rejected or failed.');
            }
        } else {
            inference = await multiModel.runSingle(taskType, sanitized, '', routing.provider);
        }

        if (!inference?.approved) {
            throw new Error(`Inference failed: ${inference?.error}`);
        }

        // SHADOW MIND: Deterministic Veto
        // The LLM output is parsed for intent and judged by the Constitution Engine.
        // If the LLM tries to execute a forbidden action, the Shadow vetoes it.
        const shadowIntent = {
            action: inference.content?.includes('DROP TABLE') || inference.content?.includes('DELETE FROM') ? 'execute_sql_write' : 'read',
            origin: 'llm',
            agentName: 'sovereign_orchestrator'
        };
        const shadowVerdict = constitutionEngine.evaluate(shadowIntent);
        if (!shadowVerdict.allowed) {
            console.error('[SHADOW MIND] VETO: LLM attempted to bypass constitution. Output blocked.');
            throw new Error('Sovereign Veto: LLM output violated constitutional law.');
        }

        // 4. الذاكرة المشتركة (Blackboard): حفظ نتيجة هذا الاستدلال للوكلاء الآخرين
        await writeMemory(contextKey, {
            last_task: taskType,
            last_model: inference.model,
            timestamp: Date.now()
        }, 3600); // يحفظ السياق لمدة ساعة

        return { inference, routing, policyDecision };
    }
}
