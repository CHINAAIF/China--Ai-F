import { Queue, Worker } from 'bullmq';
import crypto from 'crypto';

// التحقق من وجود رابط Redis (سيكون متوفراً على الابتوب أو Railway)
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.warn('[WARN] REDIS_URL is not set. Distributed queues are disabled.');
}

// إنشاء الطابور (Queue) مع إعدادات احترافية
export const inferenceQueue = new Queue('inference', {
  connection: redisUrl ? { url: redisUrl } : undefined,
  defaultJobOptions: {
    attempts: 3, // إعادة المحاولة 3 مرات في حال فشل Groq
    backoff: {
      type: 'exponential', // تأخير أسي لتجنب إرهاق الـ API
      delay: 1000,
    },
    removeOnComplete: { count: 1000 }, // الاحتفاظ بآخر 1000 مهمة ناجحة فقط
    removeOnFail: { count: 5000 },     // الاحتفاظ بآخر 5000 مهمة فاشلة للتشخيص
  },
});

/**
 * إضافة مهمة استدلال جديدة للطابور الموزع
 */
export async function addInferenceJob(payload) {
  const jobId = crypto.randomUUID();
  await inferenceQueue.add('inference', payload, { jobId });
  return jobId;
}

/**
 * استعلم عن حالة مهمة معينة من الطابور الموزع
 */
export async function getJobStatus(jobId) {
  const job = await inferenceQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id,
    state, // 'completed', 'failed', 'active', 'waiting', 'delayed'
    result: job.returnvalue,
    error: job.failedReason,
    progress: job.progress,
  };
}

// ملاحظة: المعالج (Worker) سيتم تشغيله في ملف server.js أو worker.js منفصل
// لفصل الاستدلال (CPU/GPU Intensive) عن خادم الاستجابة (HTTP Server)
