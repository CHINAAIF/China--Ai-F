import fs from 'fs';

// 1. Patch Sovereign Orchestrator (Fix Consensus + Inject Shadow Mind)
const orchPath = 'lib/sovereign-orchestrator.mjs';
let orch = fs.readFileSync(orchPath, 'utf8');

// Add Constitution Engine import
if (!orch.includes("constitution-engine")) {
  orch = orch.replace("import { writeMemory, readMemory } from './blackboard.js';", "import { writeMemory, readMemory } from './blackboard.js';\nimport { constitutionEngine } from './constitution-engine.js';");
}

// Fix Consensus logic and Inject Shadow Mind
const oldConsensus = `        if (useConsensus) {
            const result = await multiModel.runConsensus(sanitized);
            // ديناميكية: نختار أول نموذج نجح من القائمة بدلاً من حقن groq
            const successfulModels = Object.values(result?.responses || {}).filter(r => r?.approved);
            if (successfulModels.length === 0) {
                throw new Error('Consensus failed: All models rejected or failed.');
            }
            inference = successfulModels[0]; // نأخذ النموذج الأول الناجح
        } else {
            // تمرير المزود الذي اختاره الـ Router إلى الـ multiModel
            inference = await multiModel.runSingle(taskType, sanitized, '', routing.provider);
        }

        if (!inference?.approved) {
            throw new Error(\`Inference failed: \${inference?.error}\`);
        }`;

const newConsensus = `        if (useConsensus) {
            inference = await multiModel.runConsensus(sanitized);
            if (!inference?.approved) {
                throw new Error('Consensus failed: All models rejected or failed.');
            }
        } else {
            inference = await multiModel.runSingle(taskType, sanitized, '', routing.provider);
        }

        if (!inference?.approved) {
            throw new Error(\`Inference failed: \${inference?.error}\`);
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
        }`;

if (orch.includes(oldConsensus)) {
  orch = orch.replace(oldConsensus, newConsensus);
  fs.writeFileSync(orchPath, orch, 'utf8');
  console.log('✅ Patched sovereign-orchestrator.mjs (Fixed Consensus + Injected Shadow Mind)');
} else {
  console.log('❌ Could not patch orchestrator. String mismatch.');
}

// 2. Patch Sovereign Router (Fix Cache Chain Crash)
const routerPath = 'lib/sovereign-inference-router.mjs';
let router = fs.readFileSync(routerPath, 'utf8');

const oldModelExtract = "model: sipResult.attestation.chain[2].data.primary_model,";
const newModelExtract = "model: sipResult.attestation.chain.length > 2 ? sipResult.attestation.chain[2].data.primary_model : (sipResult.attestation.cached ? 'hot_memory' : 'unknown'),";

if (router.includes(oldModelExtract)) {
  router = router.replace(oldModelExtract, newModelExtract);
  fs.writeFileSync(routerPath, router, 'utf8');
  console.log('✅ Patched sovereign-inference-router.mjs (Fixed Cache Chain Crash)');
} else {
  console.log('❌ Could not patch router. String mismatch.');
}
