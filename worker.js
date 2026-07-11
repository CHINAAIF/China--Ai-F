import './config/env.js';
import { Worker } from 'bullmq';
import { handleSovereignInference } from './lib/sovereign-inference-router.mjs';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn('[WORKER] WARN: REDIS_URL is not set. Worker process is idle (No jobs to process).');
  // يبقى العملية حية ولكن لا تفعل شيئاً لمنع استنزاف الموارد
  setInterval(() => {}, 1000000); 
} else {
  console.log('[WORKER] Starting TRUNKIA Inference Worker...');

  const worker = new Worker('inference', async (job) => {
    console.log(`[WORKER] Processing job ${job.id}...`);
    const payload = job.data;
    const result = await handleSovereignInference(payload);
    return result;
  }, {
    connection: { url: redisUrl },
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    console.log(`[WORKER] Job ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job.id} failed:`, err.message);
  });

  async function shutdown() {
    console.log('[WORKER] Shutting down gracefully...');
    await worker.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
