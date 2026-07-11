import { Queue } from 'bullmq';
import crypto from 'crypto';

const redisUrl = process.env.REDIS_URL;
let inferenceQueue = null;

if (redisUrl) {
  inferenceQueue = new Queue('inference', {
    connection: { url: redisUrl },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
} else {
  console.warn('[JobQueue] WARN: REDIS_URL is not set. Distributed queues are disabled (In-Memory Fallback).');
}

export async function addInferenceJob(payload) {
  if (!inferenceQueue) {
    console.warn('[JobQueue] Fallback: Received job but Redis is disabled.');
    return crypto.randomUUID();
  }
  const jobId = crypto.randomUUID();
  await inferenceQueue.add('inference', payload, { jobId });
  return jobId;
}

export async function getJobStatus(jobId) {
  if (!inferenceQueue) return null;
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
