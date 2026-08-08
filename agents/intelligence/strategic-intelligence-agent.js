// TRUNKIA - Strategic Intelligence Fusion Agent (v3 - Sovereign Protocol Enforced)
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

        const userPrompt = `TASK: Analyze market data.
DATA:
- Pricing: ${JSON.stringify(pricingData)}
- Benchmarks: ${JSON.stringify(benchmarkData)}
- Risks: ${JSON.stringify(riskData)}

Return ONLY a JSON object with keys: top_performer, best_value, risk_alerts, recommendations. No other text.`;

        try {
            // Enforces SIP/1.0: Canary Tokens, PII Redaction, Hash Chain, Deterministic Verification
            const sipResult = await sovereignProtocol.execute(userPrompt, 'strategic_analysis');
            
            const jsonContent = this._extractJSON(sipResult.content);
            if (!jsonContent) {
                return { success: false, error: 'Failed to parse AI response' };
            }

            return { success: true, data: jsonContent, attestation: sipResult.attestation };

        } catch (error) {
            console.error(`[${AGENT_NAME}] Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    _extractJSON(text) {
        if (!text) return null;
        let cleaned = text.replace(/```jsons*/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/{[sS]*}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {
                console.error(`[${AGENT_NAME}] JSON parse error: ${e.message}`);
                return null;
            }
        }
        return null;
    }
}

export const strategicIntelligenceAgent = new StrategicIntelligenceAgent();
export default strategicIntelligenceAgent;
