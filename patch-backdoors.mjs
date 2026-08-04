import fs from 'fs';

// 1. Fix ReferenceError in sovereign-inference-router.mjs
const routerPath = 'lib/sovereign-inference-router.mjs';
let router = fs.readFileSync(routerPath, 'utf8');
if (router.includes('result.inference')) {
  router = router.replace(
    "}, { ...result.inference, content: finalContent }, result.routing, result.policyDecision).catch(() => {});",
    "}, { content: finalContent, model: sipResult.attestation.chain[2].data.primary_model }, {}, {}).catch(() => {});"
  );
  fs.writeFileSync(routerPath, router, 'utf8');
  console.log('✅ Patched sovereign-inference-router.mjs (Fixed ReferenceError)');
}

// 2. Rewrite strategic-intelligence-agent.js to use Sovereign Protocol
const agentPath = 'agents/intelligence/strategic-intelligence-agent.js';
const agentContent = `// TRUNKIA - Strategic Intelligence Fusion Agent (v3 - Sovereign Protocol Enforced)
import { sovereignProtocol } from '../../lib/sovereign-protocol.js';

const AGENT_NAME = 'strategic-intelligence';

export class StrategicIntelligenceAgent {
    constructor() {
        this.name = AGENT_NAME;
        this.layer = 'intelligence';
    }

    async analyzeMarket(pricingData, benchmarkData, riskData) {
        if (!pricingData || !benchmarkData || !riskData) {
            return { success: false, error: 'Missing required data' };
        }

        const userPrompt = \`TASK: Analyze market data.\nDATA:\n- Pricing: \${JSON.stringify(pricingData)}\n- Benchmarks: \${JSON.stringify(benchmarkData)}\n- Risks: \${JSON.stringify(riskData)}\n\nReturn ONLY a JSON object with keys: top_performer, best_value, risk_alerts, recommendations. No other text.\`;

        try {
            // Enforces SIP/1.0: Canary Tokens, PII Redaction, Hash Chain, Deterministic Verification
            const sipResult = await sovereignProtocol.execute(userPrompt, 'strategic_analysis');
            
            const jsonContent = this._extractJSON(sipResult.content);
            if (!jsonContent) {
                return { success: false, error: 'Failed to parse AI response' };
            }

            return { success: true, data: jsonContent, attestation: sipResult.attestation };

        } catch (error) {
            console.error(\`[\${AGENT_NAME}] Error: \${error.message}\`);
            return { success: false, error: error.message };
        }
    }

    _extractJSON(text) {
        if (!text) return null;
        let cleaned = text.replace(/\`\`\`json\s*/g, '').replace(/\`\`\`/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {
                console.error(\`[\${AGENT_NAME}] JSON parse error: \${e.message}\`);
                return null;
            }
        }
        return null;
    }
}

export const strategicIntelligenceAgent = new StrategicIntelligenceAgent();
export default strategicIntelligenceAgent;
`;
fs.writeFileSync(agentPath, agentContent, 'utf8');
console.log('✅ Rewrote strategic-intelligence-agent.js (Sovereign Protocol Enforced)');

// 3. Patch /api/inference/chat in index.js to use Sovereign Protocol
const indexPath = 'index.js';
let index = fs.readFileSync(indexPath, 'utf8');

const oldChatBlock = `    const startTime = Date.now();
    const inferenceResult = await executeInference(contextMessages, taskType);
    const latency = Date.now() - startTime;
    if (!inferenceResult.success) {
      await logInferenceAsync({ request_hash: crypto.createHash('sha256').update(sanitized).digest('hex'), task_type: taskType, model_used: inferenceResult.model_used || 'NONE', latency_ms: latency, tokens_in: 0, tokens_out: 0, cost_usd: 0, outcome: 'failed' });
      return res.status(502).json({ error: inferenceResult.error || 'INFERENCE_FAILED' });
    }
    const safeContent = sanitizeOutput(inferenceResult.content);`;

const newChatBlock = `    const startTime = Date.now();
    const promptText = Array.isArray(contextMessages) ? JSON.stringify(contextMessages) : contextMessages;
    const sipResult = await sovereignProtocol.execute(promptText, taskType);
    const latency = Date.now() - startTime;
    const safeContent = sanitizeOutput(sipResult.content);`;

if (index.includes(oldChatBlock)) {
  index = index.replace(oldChatBlock, newChatBlock);
  
  // Fix the response object to include attestation
  index = index.replace(
    "res.json({ success: true, content: safeContent, model: inferenceResult.model_used, provider: inferenceResult.provider, session_id, pii_flags: flags });",
    "res.json({ success: true, content: safeContent, model: sipResult.attestation.chain[2].data.primary_model, session_id, pii_flags: flags, sovereign_attestation: sipResult.attestation });"
  );
  
  fs.writeFileSync(indexPath, index, 'utf8');
  console.log('✅ Patched index.js /api/inference/chat (Sovereign Protocol Enforced)');
} else {
  console.log('⚠️ Could not find the chat block in index.js. Manual review required.');
}
