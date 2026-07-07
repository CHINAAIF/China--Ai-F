import './config/env.js';
import { Worker } from 'bullmq';
import { handleSovereignInference } from './lib/sovereign-inference-router.mjs';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[FATAL] Worker cannot start without REDIS_URL.');
  process.exit(1);
}

console.log('[WORKER] Starting TRUNKIA Inference Worker...');

const worker = new Worker('inference', async (job) => {
  console.log(`[WORKER] Processing job ${job.id}...`);
  
  const { payload } = job.data;
  
  // استدعاء دالة الاستدلال الحقيقية الموجودة في نظامك
  const result = await handleSovereignInference(payload);
  
  return result; // ستُحفظ النتيجة تلقائياً في Redis ويستطيع الـ API جلبها

}, {
  connection: { url: redisUrl },
  concurrency: 3, // معالجة 3 طلبات ذكاء اصطناعي بالتوازي (قابل للتوسع)
});

worker.on('completed', (job) => {
  console.log(`[WORKER] Job ${job.id} completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job.id} failed:`, err.message);
});

// Graceful Shutdown للـ Worker أيضاً
async function shutdown() {
  console.log('[WORKER] Shutting down gracefully...');
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
