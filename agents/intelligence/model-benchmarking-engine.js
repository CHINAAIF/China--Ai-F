import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
import Groq from 'groq-sdk';
import crypto from 'crypto';
import { logExecution, safeStep, tableExists } from '../utils/executor.js';

var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
var groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

var BENCHMARK_DOMAINS = ['financial', 'policy', 'analysis', 'content', 'pricing'];

var BENCHMARK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct'
];

var DOMAIN_QUESTIONS = {
  financial: [
    'ما هو الفرق بين P/E ratio و P/B ratio في تقييم الشركات؟ أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'ما هي تأثيرات رفع سعر الفائدة على سوق الأسهم؟ أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'اشرح مفهوم现金流 حر (Free Cash Flow) وأهميته. أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}'
  ],
  policy: [
    'ما هي أبرز قوانين تنظيم الذكاء الاصطناعي في الاتحاد الأوروبي؟ أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'قارن بين سياسة الصين والولايات المتحدة في تصدير تقنيات AI. أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'ما هي مخاطر استخدام AI في اتخاذ قرارات حكومية؟ أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}'
  ],
  analysis: [
    'قارن بين GPT-4 و Claude 3.5 من حيث الأداء في المهام التحليلية. أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'ما هي مزايا وعيوب نماذج الذكاء الاصطناعي مفتوحة المصدر مقارنة بالمغلقة؟ أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}',
    'حلل اتجاهات سوق الذكاء الاصطناعي لعام 2026. أجب بـJSON: {answer: "...", key_points: [...], confidence: 0-100}'
  ],
  content: [
    'اكتب ملخصاً من 3 نقاط عن أهمية تحسين محركات البحث. أجب بـJSON: {summary: "...", key_points: [...], confidence: 0-100}',
    'حول النص التالي إلى نقاط رئيسية: الذكاء الاصطناعي يغير طريقة عملنا. أجب بـJSON: {key_points: [...], confidence: 0-100}',
    'أنتج عنوان جذاب لمقال عن أمن البيانات. أجب بـJSON: {title: "...", alternatives: [...], confidence: 0-100}'
  ],
  pricing: [
    'ما هي نماذج التسعير الشائعة لخدمات API؟ أجب بـJSON: {answer: "...", models: [...], confidence: 0-100}',
    'قارن تسعير Groq مقابل OpenAI لكل مليون توكن. أجب بـJSON: {comparison: {...}, confidence: 0-100}',
    'كيف تحسب تكلفة تشغيل نموذج AI شهرياً؟ أجب بـJSON: {answer: "...", factors: [...], confidence: 0-100}'
  ]
};

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function extractConfidence(parsed) {
  var raw = Number(parsed && parsed.confidence);
  if (!parsed || parsed.confidence === undefined || parsed.confidence === null || isNaN(raw)) return 75;
  return Math.min(100, Math.max(0, Math.round(raw <= 1 ? raw * 100 : raw)));
}

function extractLatency(start) {
  return Date.now() - start;
}

async function callModel(prompt, modelKey, temp) {
  var start = Date.now();
  try {
    var res = await groq.chat.completions.create({
      model: modelKey,
      messages: [
        { role: 'system', content: 'You are a JSON-only AI. Respond ONLY with valid JSON. No markdown, no explanation.' },
        { role: 'user', content: prompt }
      ],
      temperature: temp || 0.3,
      max_tokens: 800
    });
    var raw = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content ? res.choices[0].message.content : '';
    var clean = raw.replace(/```json|```/g, '').trim();
    var parsed;
    try {
      parsed = JSON.parse(clean);
    } catch(_) {
      var match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no_json');
      parsed = JSON.parse(match[0]);
    }
    return {
      success: true,
      data: parsed,
      confidence: extractConfidence(parsed),
      latency_ms: extractLatency(start),
      error: null
    };
  } catch(e) {
    return {
      success: false,
      data: null,
      confidence: 0,
      latency_ms: extractLatency(start),
      error: e.message
    };
  }
}

function compareResponses(responses) {
  // Simple overlap comparison of top-level keys
  var allKeys = [];
  var keySets = [];
  for (var i = 0; i < responses.length; i++) {
    if (responses[i].success && responses[i].data) {
      var keys = Object.keys(responses[i].data).filter(function(k) { return !k.startsWith('_'); });
      keySets.push(new Set(keys));
      keys.forEach(function(k) { if (allKeys.indexOf(k) === -1) allKeys.push(k); });
    } else {
      keySets.push(new Set());
    }
  }
  if (allKeys.length === 0) return 0;
  var overlapCounts = allKeys.map(function(k) {
    var count = 0;
    for (var i = 0; i < keySets.length; i++) {
      if (keySets[i].has(k)) count++;
    }
    return count;
  });
  var totalOverlap = overlapCounts.reduce(function(a, b) { return a + b; }, 0);
  var maxPossible = allKeys.length * keySets.length;
  return maxPossible > 0 ? Math.round((totalOverlap / maxPossible) * 100) : 0;
}

async function writeEventLog(eventType, agentId, payload) {
  try {
    var payloadStr = JSON.stringify(payload);
    var evtHash = crypto.createHash('sha256').update(payloadStr, 'utf8').digest('hex');
    await pool.query(
      'INSERT INTO event_log (event_type, agent_id, payload, payload_hash, created_at) VALUES ($1,$2,$3::jsonb,$4,NOW())',
      [eventType, agentId, payloadStr, evtHash]
    );
  } catch(_) {}
}

class ModelBenchmarkingEngine {
  constructor() {
    this.name = 'model_benchmarking_engine';
    this.layer = 'intelligence';
    this.status = 'active';
  }

  async initialize() {
    try {
      await pool.query('SELECT 1');
      var tables = ['model_accuracy_registry', 'model_consensus'];
      for (var i = 0; i < tables.length; i++) {
        var exists = await tableExists(tables[i]);
        if (!exists) { this.status = 'missing_table:' + tables[i]; return false; }
      }
      return true;
    } catch(e) {
      this.status = 'db_error';
      return false;
    }
  }

  // Run one question against all models
  async benchmarkQuestion(question, domain) {
    var taskId = crypto.randomUUID();
    var results = {};
    var responses = [];

    for (var i = 0; i < BENCHMARK_MODELS.length; i++) {
      var modelKey = BENCHMARK_MODELS[i];
      var result = await callModel(question, modelKey, 0.3);
      results[modelKey] = result;
      responses.push(result);
    }

    var agreement = compareResponses(responses);

    // Find consensus: if 2+ models agree on key points
    var successfulResults = responses.filter(function(r) { return r.success; });
    var avgConfidence = successfulResults.length > 0
      ? Math.round(successfulResults.reduce(function(a, r) { return a + r.confidence; }, 0) / successfulResults.length)
      : 0;
    var avgLatency = successfulResults.length > 0
      ? Math.round(successfulResults.reduce(function(a, r) { return a + r.latency_ms; }, 0) / successfulResults.length)
      : 0;

    // Write to model_consensus
    try {
      var consensusData = {
        groq_response: results['llama-3.3-70b-versatile'] ? results['llama-3.3-70b-versatile'].data : null,
        gemini_response: null,
        deepseek_response: null,
        mistral_response: null,
        consensus_reached: agreement >= 60,
        consensus_result: {
          agreement_score: agreement,
          avg_confidence: avgConfidence,
          avg_latency_ms: avgLatency,
          models_tested: BENCHMARK_MODELS.length,
          models_succeeded: successfulResults.length
        },
        disagreement_log: agreement < 60 ? {
          agreement: agreement,
          per_model_confidence: {}
        } : null
      };

      // Add per-model confidence to disagreement log
      if (agreement < 60) {
        for (var mk in results) {
          consensusData.disagreement_log.per_model_confidence[mk] = {
            success: results[mk].success,
            confidence: results[mk].confidence,
            latency: results[mk].latency_ms,
            error: results[mk].error
          };
        }
      }

      await pool.query(
        'INSERT INTO model_consensus (task_id, task_type, input_data, groq_response, gemini_response, deepseek_response, mistral_response, consensus_reached, consensus_result, disagreement_log, created_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::jsonb,NOW())',
        [
          taskId, domain, JSON.stringify({ question: question }),
          consensusData.groq_response, consensusData.gemini_response,
          consensusData.deepseek_response, consensusData.mistral_response,
          consensusData.consensus_reached, consensusData.consensus_result,
          consensusData.disagreement_log
        ]
      );
    } catch(e) {
      console.error('[benchmark] consensus write error: ' + e.message);
    }

    // Update model_accuracy_registry for each model
    for (var mk2 in results) {
      var r = results[mk2];
      if (!r.success) continue;
      try {
        // Check if entry exists
        var existing = await pool.query(
          'SELECT id, accuracy_score, sample_count, avg_latency_ms, avg_confidence FROM model_accuracy_registry WHERE model_key=$1 AND domain=$2',
          [mk2, domain]
        );
        if (existing.rows.length > 0) {
          var ex = existing.rows[0];
          var newCount = (ex.sample_count || 0) + 1;
          // Running average
          var newAccuracy = Math.round(((ex.accuracy_score * (ex.sample_count || 1)) + r.confidence) / newCount);
          var newAvgLatency = Math.round(((ex.avg_latency_ms || 0) * (ex.sample_count || 1) + r.latency_ms) / newCount);
          var newAvgConf = Math.round(((ex.avg_confidence || 0) * (ex.sample_count || 1) + r.confidence) / newCount);

          // accuracy_score 0-100 CHECK constraint
          newAccuracy = Math.min(100, Math.max(0, newAccuracy));
          newAvgConf = Math.min(100, Math.max(0, newAvgConf));

          await pool.query(
            'UPDATE model_accuracy_registry SET accuracy_score=$1, sample_count=$2, avg_latency_ms=$3, avg_confidence=$4, last_benchmarked=NOW() WHERE id=$5',
            [newAccuracy, newCount, newAvgLatency, newAvgConf, ex.id]
          );
        } else {
          var safeConf = Math.min(100, Math.max(0, r.confidence));
          await pool.query(
            'INSERT INTO model_accuracy_registry (model_key, domain, accuracy_score, sample_count, avg_latency_ms, avg_confidence, last_benchmarked, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())',
            [mk2, domain, safeConf, 1, r.latency_ms, safeConf]
          );
        }
      } catch(e) {
        console.error('[benchmark] registry update error for ' + mk2 + ': ' + e.message);
      }
    }

    return {
      task_id: taskId,
      domain: domain,
      question: question,
      results: results,
      agreement: agreement,
      avg_confidence: avgConfidence,
      avg_latency_ms: avgLatency,
      models_succeeded: successfulResults.length,
      models_total: BENCHMARK_MODELS.length
    };
  }

  // Run full benchmark for one domain
  async benchmarkDomain(domain) {
    var questions = DOMAIN_QUESTIONS[domain];
    if (!questions) return { success: false, error: 'unknown_domain:' + domain };

    var allResults = [];
    var totalAgreement = 0;
    var totalConfidence = 0;
    var totalLatency = 0;

    for (var i = 0; i < questions.length; i++) {
      var result = await this.benchmarkQuestion(questions[i], domain);
      allResults.push(result);
      totalAgreement += result.agreement;
      totalConfidence += result.avg_confidence;
      totalLatency += result.avg_latency_ms;
    }

    var summary = {
      domain: domain,
      questions_tested: questions.length,
      avg_agreement: Math.round(totalAgreement / questions.length),
      avg_confidence: Math.round(totalConfidence / questions.length),
      avg_latency_ms: Math.round(totalLatency / questions.length),
      timestamp: new Date().toISOString()
    };

    await writeEventLog('benchmark_domain_complete', this.name, summary);

    return { success: true, summary: summary, results: allResults };
  }

  // Run full benchmark across all domains
  async benchmarkAll() {
    var domainResults = {};
    for (var i = 0; i < BENCHMARK_DOMAINS.length; i++) {
      var domain = BENCHMARK_DOMAINS[i];
      console.log('[benchmark] starting domain: ' + domain);
      try {
        domainResults[domain] = await this.benchmarkDomain(domain);
      } catch(e) {
        domainResults[domain] = { success: false, error: e.message };
      }
    }

    var summary = {
      domains_tested: BENCHMARK_DOMAINS.length,
      domains_succeeded: Object.values(domainResults).filter(function(r) { return r.success; }).length,
      timestamp: new Date().toISOString()
    };

    await writeEventLog('benchmark_all_complete', this.name, summary);

    return { success: true, summary: summary, domains: domainResults };
  }

  // Get current rankings
  async getRankings(domain) {
    try {
      var query = 'SELECT model_key, domain, accuracy_score, sample_count, avg_latency_ms, avg_confidence FROM model_accuracy_registry';
      var params = [];
      if (domain) {
        query += ' WHERE domain=$1';
        params.push(domain);
      }
      query += ' ORDER BY accuracy_score DESC, avg_latency_ms ASC';
      var result = await pool.query(query, params);
      return { success: true, rankings: result.rows };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  async runDiagnostic() {
    var init = await this.initialize();
    var rankings = await this.getRankings(null);
    return {
      agent: this.name,
      status: init ? 'ok' : this.status,
      models_available: BENCHMARK_MODELS.length,
      domains_available: BENCHMARK_DOMAINS.length,
      total_registry_entries: rankings.success ? rankings.rankings.length : 0,
      timestamp: new Date().toISOString()
    };
  }
}

export var modelBenchmarkingEngine = new ModelBenchmarkingEngine();
export default modelBenchmarkingEngine;

export async function run(input = {}) {
  try {
    return { success: true, data: { agent: 'model-benchmarking-engine', status: 'ok' } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
