// TRUNKIA - Strategic Intelligence Fusion Agent (v2 - Robust JSON parsing)
import { multiModel } from '../governance/multi-model.js';

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

        const systemPrompt = 'You are TRUNKIA Strategic Intelligence Core. Analyze the market data. Return ONLY a valid JSON object. No markdown.';
        const userPrompt = `TASK: Analyze market data.\nDATA:\n- Pricing: ${JSON.stringify(pricingData)}\n- Benchmarks: ${JSON.stringify(benchmarkData)}\n- Risks: ${JSON.stringify(riskData)}\n\nReturn ONLY a JSON object with keys: top_performer, best_value, risk_alerts, recommendations. No other text.`;

        try {
            const result = await multiModel.runSingle('strategic_analysis', userPrompt, systemPrompt);

            if (!result?.approved || !result.content) {
                return { success: false, error: 'AI analysis failed' };
            }

            const jsonContent = this._extractJSON(result.content);
            if (!jsonContent) {
                return { success: false, error: 'Failed to parse AI response' };
            }

            return { success: true, data: jsonContent, model: result.model };

        } catch (error) {
            console.error(`[${AGENT_NAME}] Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    _extractJSON(text) {
        if (!text) return null;
        let cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
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
