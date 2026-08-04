// lib/sovereign-orchestrator.mjs
// العقليات: 100 خبير من فئة القوة العظمى
import { multiModel } from '../agents/governance/multi-model.js';
import { tacticalRouter } from '../agents/governance/tactical-routing.js';
import { policyEnforcer } from '../agents/governance/policy-enforcer.js';
import { writeMemory, readMemory, generateMemoryToken } from './blackboard.js';
import { constitutionEngine } from './constitution-engine.js';

const orchToken = generateMemoryToken('orchestrator');

export class SovereignOrchestrator {
    static async execute({ sanitized, taskType, customerId, sessionId, preferences, threatScore }) {

        const contextKey = `session:${sessionId}:context`;
        const previousContext = await readMemory(contextKey) || {};

        const policyDecision = await policyEnforcer.enforce({
            customer_id: customerId,
            action: 'inference',
            resource: taskType,
            context: { threat_score: threatScore, history: previousContext }
        });
        if (!policyDecision.allowed) {
            throw new Error(`Policy blocked: ${policyDecision.reason}`);
        }

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

        // DETERMINISTIC JSON SCHEMA LOCK
        // We wrap the user prompt to force the LLM to return a strict JSON schema.
        const schemaLockPrompt = `You must respond ONLY with a valid JSON object: {"action": "read", "content": "your_response"}. Do not include any text outside the JSON.\n\nTask: ${sanitized}`;

        const useConsensus = preferences?.consensus || threatScore > 0.65;
        let inference;

        if (useConsensus) {
            inference = await multiModel.runConsensus(schemaLockPrompt);
            if (!inference?.approved) {
                throw new Error('Consensus failed: All models rejected or failed.');
            }
        } else {
            inference = await multiModel.runSingle(taskType, schemaLockPrompt, '', routing.provider);
        }

        if (!inference?.approved) {
            throw new Error(`Inference failed: ${inference?.error}`);
        }

        // SHADOW MIND: Deterministic Veto & Lie Trap
        let parsedLLM;
        try {
            // Clean markdown if present
            let cleanJson = inference.content.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedLLM = JSON.parse(cleanJson);
        } catch (e) {
            console.error('[SHADOW MIND] VETO: LLM failed to adhere to JSON Schema Lock.');
            throw new Error('Sovereign Veto: LLM output is not valid JSON.');
        }

        // 1. Deterministic Intent Calculation (De-obfuscated)
        // We DO NOT trust the LLM's declared action. We calculate it mathematically from the content.
        const compactText = (parsedLLM.content || '').replace(/[\s\.\,\;\:\!\?\_\-\*\/\\]/g, '').toLowerCase();
        const calculatedAction = (compactText.includes('droptable') || compactText.includes('deletefrom') || compactText.includes('rm-rf')) ? 'execute_sql_write' : 'read';

        // 2. The Lie Trap
        // If the LLM's declared action does not match our mathematical calculation, it's lying.
        if (parsedLLM.action !== calculatedAction) {
            console.error(`[SHADOW MIND] VETO: LLM lied about its action. Declared: ${parsedLLM.action}, Calculated: ${calculatedAction}`);
            throw new Error('Sovereign Veto: LLM attempted deception (Action Mismatch).');
        }

        // 3. Constitutional Evaluation
        const shadowIntent = {
            action: calculatedAction,
            origin: 'llm',
            agentName: 'sovereign_orchestrator',
            userId: customerId
        };
        const shadowVerdict = constitutionEngine.evaluate(shadowIntent);
        if (!shadowVerdict.allowed) {
            console.error('[SHADOW MIND] VETO: LLM attempted to bypass constitution. Output blocked.');
            throw new Error('Sovereign Veto: LLM output violated constitutional law.');
        }

        // Reconstruct inference content for downstream consumers
        inference.content = parsedLLM.content;

        // 4. Save context to Blackboard
        await writeMemory(contextKey, {
            last_task: taskType,
            last_model: inference.model,
            timestamp: Date.now()
        }, 3600, orchToken);

        return { inference, routing, policyDecision };
    }
}
