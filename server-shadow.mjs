import express from 'express';
import { validateApiKeyAndQuota, generateNewApiKey } from './lib/iam-gateway.mjs';
import { classifyTask } from './lib/sovereign-classifier.mjs';
import tokenMeter from './lib/sovereign-token-meter.mjs';
import { sovereignProtocol } from './lib/sovereign-protocol.js';
import { sanitizeOutput } from './lib/inference.js';
import crypto from 'crypto';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/v1/chat/completions', async (req, res) => {
  console.log('[TRACE] Request received');
  try {
    const authHeader = req.get('authorization') || '';
    const rawKey = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const authResult = await validateApiKeyAndQuota(rawKey);
    if (!authResult.valid) return res.status(401).json({ error: { message: 'Unauthorized' } });

    const prompt = req.body?.messages?.slice(-1)[0]?.content || '';
    const routingProfile = classifyTask(prompt);
    const inputTokens = tokenMeter.countTokens(prompt);
    
    console.log('[TRACE] Executing Sovereign Protocol...');
    const startTime = Date.now();
    const sipResult = await sovereignProtocol.execute(prompt, routingProfile.tier, authResult.userId);
    const latency = Date.now() - startTime;
    const safeContent = sanitizeOutput(sipResult.content);
    const outputTokens = tokenMeter.countTokens(safeContent);
    const actualCost = tokenMeter.calculateActualCost(inputTokens, outputTokens);

    console.log('[TRACE] Success. Sending response.');
    res.json({
      id: 'chatcmpl-' + crypto.randomBytes(12).toString('hex'),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'trunkia-shadow-1.0',
      choices: [{ index: 0, message: { role: 'assistant', content: safeContent }, finish_reason: 'stop' }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: actualCost }
    });
  } catch (err) {
    console.error('[SHADOW API] Error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

app.listen(8080, () => console.log('🚀 Shadow Server running on :8080'));
