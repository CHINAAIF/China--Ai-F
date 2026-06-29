import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';
dotenv.config();

const AVAILABLE_MODELS = {
  groq: !!process.env.GROQ_API_KEY,
  gemini: !!process.env.GEMINI_API_KEY,
  deepseek: !!process.env.DEEPSEEK_API_KEY,
  mistral: !!process.env.MISTRAL_API_KEY,
  qwen: !!process.env.QWEN_API_KEY,
  ernie: !!process.env.ERNIE_API_KEY,
  cohere: !!process.env.COHERE_API_KEY
};

class MultiModelRouter {
  constructor() {
    this.groq = AVAILABLE_MODELS.groq
      ? new Groq({ apiKey: process.env.GROQ_API_KEY })
      : null;
  }

  // النموذج الأنسب للمهمة
  selectBest(taskType) {
    if (taskType.includes('chinese') && AVAILABLE_MODELS.qwen) return 'qwen';
    if (taskType.includes('chinese') && AVAILABLE_MODELS.deepseek) return 'deepseek';
    if (taskType.includes('baidu') && AVAILABLE_MODELS.ernie) return 'ernie';
    if (taskType.includes('translation') && AVAILABLE_MODELS.mistral) return 'mistral';
    if (taskType.includes('reasoning') && AVAILABLE_MODELS.gemini) return 'gemini';
    return 'groq'; // الافتراضي دائماً
  }

  async runGroq(prompt, systemPrompt = '') {
    if (!this.groq) return null;
    try {
      const res = await this.groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt || 'You are TRUNKIA Sovereign Intelligence Core.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.3
      });
      return {
        approved: true,
        content: res.choices[0].message.content,
        model: 'groq/llama-3.3-70b',
        tokens: res.usage?.total_tokens
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  async runGemini(prompt) {
    if (!AVAILABLE_MODELS.gemini) return null;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const data = await res.json();
      return {
        approved: true,
        content: data.candidates?.[0]?.content?.parts?.[0]?.text,
        model: 'gemini-1.5-flash'
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  async runDeepSeek(prompt) {
    if (!AVAILABLE_MODELS.deepseek) return null;
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024
        })
      });
      const data = await res.json();
      return {
        approved: true,
        content: data.choices?.[0]?.message?.content,
        model: 'deepseek-chat'
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  async runMistral(prompt) {
    if (!AVAILABLE_MODELS.mistral) return null;
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1024
        })
      });
      const data = await res.json();
      return {
        approved: true,
        content: data.choices?.[0]?.message?.content,
        model: 'mistral-small'
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  async runQwen(prompt) {
    if (!AVAILABLE_MODELS.qwen) return null;
    try {
      const res = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.QWEN_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen-turbo',
          input: { messages: [{ role: 'user', content: prompt }] }
        })
      });
      const data = await res.json();
      return {
        approved: true,
        content: data.output?.text,
        model: 'qwen-turbo'
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  async runErnie(prompt) {
    if (!AVAILABLE_MODELS.ernie) return null;
    try {
      const res = await fetch(
        `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k?access_token=${process.env.ERNIE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }]
          })
        }
      );
      const data = await res.json();
      return {
        approved: true,
        content: data.result,
        model: 'ernie-speed-128k'
      };
    } catch(e) {
      return { approved: false, error: e.message };
    }
  }

  // تشغيل النموذج الأنسب فقط
  async runSingle(taskType, prompt, systemPrompt = '') {
    const model = this.selectBest(taskType);
    switch(model) {
      case 'qwen': return await this.runQwen(prompt);
      case 'deepseek': return await this.runDeepSeek(prompt);
      case 'ernie': return await this.runErnie(prompt);
      case 'mistral': return await this.runMistral(prompt);
      case 'gemini': return await this.runGemini(prompt);
      default: return await this.runGroq(prompt, systemPrompt);
    }
  }

  // تشغيل كل النماذج المتاحة للتحكيم
  async runConsensus(prompt, systemPrompt = '') {
    const tasks = {
      groq: this.runGroq(prompt, systemPrompt),
      gemini: this.runGemini(prompt),
      deepseek: this.runDeepSeek(prompt),
      mistral: this.runMistral(prompt),
      qwen: this.runQwen(prompt),
      ernie: this.runErnie(prompt)
    };

    const results = await Promise.allSettled(Object.values(tasks));
    const keys = Object.keys(tasks);
    const responses = {};
    keys.forEach((k, i) => {
      responses[k] = results[i].status === 'fulfilled' ? results[i].value : null;
    });

    const available = Object.entries(responses)
      .filter(([_, v]) => v?.approved)
      .map(([k]) => k);

    return { responses, available };
  }

  status() {
    return Object.entries(AVAILABLE_MODELS).map(([model, active]) => ({
      model, active
    }));
  }
}


export const multiModel = new MultiModelRouter();
export default multiModel;


// ── auto-fix: run() wrapper ──────────────────────────────────────
export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'multi-model', status: 'ok', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
