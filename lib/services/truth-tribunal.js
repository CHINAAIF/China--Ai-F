/**
 * TRUNKIA Truth Tribunal v1.0 (Omega Protocol)
 * 
 * Three-Judge System:
 * 1. Deterministic Judge (Grounding Engine - lexical contradiction detection)
 * 2. Antagonist Judge (LLM - tries to find errors/hallucinations)
 * 3. Consensus Judge (LLM - evaluates accuracy)
 * 
 * Verdict: 2/3 majority required to ACCEPT.
 * Timeout: 3 seconds overall (Promise.race).
 * Truncation: 1000 chars max for verification (token conservation).
 * Provider Diversity: Consensus uses different provider if available.
 * 
 * International Standard: No language bias. JSON-only LLM responses.
 * Designed for Cloud Enterprise (K8s, multi-pod, horizontal scaling).
 */

import OpenAI from 'openai';
import { getRoutingChain } from '../sovereign-router.mjs';

const VERIFY_TIMEOUT_MS = 5000;
const TRIBUNAL_TIMEOUT_MS = 3000;
const MAX_VERIFY_TEXT = 1000;
const MAX_PROMPT_TEXT = 500;
const MAX_HISTORY = 100;

class TruthTribunal {
  constructor() {
    this.accuracyHistory = [];
  }

  async verify(prompt, response, taskType, groundingResult) {
    if (!response || response.trim().length < 10) {
      return { verdict: 'ACCEPTED', confidence: 100, reason: 'SHORT_RESPONSE', judges: {}, votes: { accept: 3, reject: 0 } };
    }

    const truncatedResponse = response.substring(0, MAX_VERIFY_TEXT);
    const truncatedPrompt = prompt.substring(0, MAX_PROMPT_TEXT);

    let antagonist = { verdict: 'ABSTAIN', reason: 'TIMEOUT' };
    let consensus = { verdict: 'ABSTAIN', reason: 'TIMEOUT' };

    try {
      const results = await Promise.race([
        Promise.allSettled([
          this._antagonistJudge(truncatedPrompt, truncatedResponse, taskType),
          this._consensusJudge(truncatedPrompt, truncatedResponse, taskType)
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), TRIBUNAL_TIMEOUT_MS))
      ]);

      antagonist = results[0].status === 'fulfilled' ? results[0].value : { verdict: 'ABSTAIN', reason: 'ERROR' };
      consensus = results[1].status === 'fulfilled' ? results[1].value : { verdict: 'ABSTAIN', reason: 'ERROR' };
    } catch (e) {
      // Timeout: both abstain
    }

    const deterministicVerdict = groundingResult ? (groundingResult.grounded ? 'ACCEPT' : 'REJECT') : 'ABSTAIN';

    let acceptVotes = 0;
    let rejectVotes = 0;

    if (deterministicVerdict === 'ACCEPT') acceptVotes++;
    else if (deterministicVerdict === 'REJECT') rejectVotes++;

    if (antagonist.verdict === 'ACCEPT') acceptVotes++;
    else if (antagonist.verdict === 'REJECT') rejectVotes++;

    if (consensus.verdict === 'ACCEPT') acceptVotes++;
    else if (consensus.verdict === 'REJECT') rejectVotes++;

    const verdict = acceptVotes >= 2 ? 'ACCEPTED' : 'REJECTED';
    const confidence = Math.round((acceptVotes / 3) * 100);

    this._recordVerdict(verdict);

    return {
      verdict,
      confidence,
      judges: {
        deterministic: { verdict: deterministicVerdict, score: groundingResult ? groundingResult.confidence : 75 },
        antagonist: antagonist,
        consensus: consensus
      },
      votes: { accept: acceptVotes, reject: rejectVotes }
    };
  }

  async _antagonistJudge(prompt, response, taskType) {
    try {
      const chain = await getRoutingChain(taskType);
      if (!chain || chain.length === 0) return { verdict: 'ABSTAIN', reason: 'NO_PROVIDER' };

      const provider = chain[0];
      const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey, timeout: VERIFY_TIMEOUT_MS });

      const result = await client.chat.completions.create({
        model: provider.modelName,
        messages: [
          { role: 'system', content: 'You are an Antagonist Judge. Find errors or hallucinations. Respond ONLY with JSON: {"verdict":"ACCEPT","reason":"brief"} or {"verdict":"REJECT","reason":"brief"}' },
          { role: 'user', content: 'Question: ' + prompt + '\n\nResponse: ' + response + '\n\nFind any errors.' }
        ],
        max_tokens: 100,
        temperature: 0.1
      });

      const content = result.choices?.[0]?.message?.content || '';
      return this._parseVerdict(content);
    } catch (e) {
      return { verdict: 'ABSTAIN', reason: 'ERROR' };
    }
  }

  async _consensusJudge(prompt, response, taskType) {
    try {
      const chain = await getRoutingChain(taskType);
      if (!chain || chain.length === 0) return { verdict: 'ABSTAIN', reason: 'NO_PROVIDER' };

      const provider = chain[1] || chain[0];
      const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey, timeout: VERIFY_TIMEOUT_MS });

      const result = await client.chat.completions.create({
        model: provider.modelName,
        messages: [
          { role: 'system', content: 'You are a Consensus Judge. Evaluate accuracy. Respond ONLY with JSON: {"verdict":"ACCEPT","reason":"brief"} or {"verdict":"REJECT","reason":"brief"}' },
          { role: 'user', content: 'Question: ' + prompt + '\n\nResponse: ' + response + '\n\nIs this accurate?' }
        ],
        max_tokens: 100,
        temperature: 0.1
      });

      const content = result.choices?.[0]?.message?.content || '';
      return this._parseVerdict(content);
    } catch (e) {
      return { verdict: 'ABSTAIN', reason: 'ERROR' };
    }
  }

  _parseVerdict(content) {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.verdict === 'ACCEPT' || parsed.verdict === 'REJECT') {
          return { verdict: parsed.verdict, reason: (parsed.reason || 'N/A').substring(0, 100) };
        }
      }
    } catch (e) {}
    const lower = content.toLowerCase();
    if (lower.includes('reject')) return { verdict: 'REJECT', reason: 'KEYWORD' };
    if (lower.includes('accept')) return { verdict: 'ACCEPT', reason: 'KEYWORD' };
    return { verdict: 'ABSTAIN', reason: 'UNPARSEABLE' };
  }

  _recordVerdict(verdict) {
    const accepted = verdict === 'ACCEPTED' ? 1 : 0;
    this.accuracyHistory.push(accepted);
    if (this.accuracyHistory.length > MAX_HISTORY) this.accuracyHistory.shift();
  }

  getAccuracy() {
    if (this.accuracyHistory.length === 0) return 100;
    const sum = this.accuracyHistory.reduce((a, b) => a + b, 0);
    return Math.round((sum / this.accuracyHistory.length) * 100);
  }
}

const tribunal = new TruthTribunal();
export const truthTribunal = tribunal;
export default tribunal;
