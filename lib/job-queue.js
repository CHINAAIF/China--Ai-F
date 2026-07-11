import { Queue, Worker } from 'bullmq';
import crypto from 'crypto';

const redisUrl = process.env.REDIS_URL;

// 1. التحقق من وجود رابط Redis
if (!redisUrl) {
  console.warn('[JobQueue] WARN: REDIS_URL is not set. Distributed queues are disabled (In-Memory Fallback).');
  
  // توفير دوال وهمية (Mocks) لمنع انهيار النظام
  export async function addInferenceJob(payload) {
    console.warn('[JobQueue] Fallback: Received job but Redis is disabled.');
    return crypto.randomUUID();
  }

  export async function getJobStatus(jobId) {
    return null;
  }

} else {
  // 2. إذا كان Redis متوفراً، استخدم BullMQ الحقيقي
  const inferenceQueue = new Queue('inference', {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  export async function addInferenceJob(payload) {
    const jobId = crypto.randomUUID();
    await inferenceQueue.add('inference', payload, { jobId });
    return jobId;
  }

  export async function getJobStatus(jobId) {
    const job = await inferenceQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      id: job.id,
      state,
      result: job.returnvalue,
      error: job.failedReason,
    };
  }
}
