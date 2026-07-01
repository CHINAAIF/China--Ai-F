// TRUNKIA - arXiv Sentinel Agent
// Team Engineering Standards: 60-Layer Filtered
// يكتشف الأبحاث الجديدة على arXiv قبل المنافسين

import { multiModel } from '../governance/multi-model.js';
import crypto from 'crypto';

const AGENT_NAME = 'arxiv-sentinel';

export class ArxivSentinelAgent {
    constructor() {
        this.name = AGENT_NAME;
        this.layer = 'intelligence';
    }

    async scan(topic) {
        if (!topic || typeof topic !== 'string') {
            return { success: false, error: 'Invalid topic' };
        }

        const systemPrompt = 'You are an AI research analyst. Return ONLY a valid JSON array. No other text.';
        const userPrompt = `TASK: List the 3 most recent and important AI research papers about "${topic}" from arXiv or similar venues.\n\nReturn ONLY a JSON array with objects like:\n[{"title": "...", "authors": ["..."], "abstract": "...", "url": "https://arxiv.org/abs/...", "year": 2026}]\nIf you cannot find real papers, return an empty array [].\n\nDo NOT include any other text.`;

        try {
            const result = await multiModel.runSingle('research_analysis', userPrompt, systemPrompt);

            if (!result?.approved || !result.content) {
                return { success: false, error: 'AI analysis failed' };
            }

            const papers = this._extractJSON(result.content);
            if (!papers) {
                return { success: false, error: 'Failed to parse AI response' };
            }

            return { success: true, data: papers, model: result.model };

        } catch (error) {
            console.error(`[${AGENT_NAME}] Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    _extractJSON(text) {
        if (!text) return null;
        let cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
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

export const arxivSentinelAgent = new ArxivSentinelAgent();
export default arxivSentinelAgent;
