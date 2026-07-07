import Redis from 'ioredis';

// استخدام REDIS_URL إذا كان متوفراً (للإنتاج/الابتوب)، أو الذاكرة المحلية للتطوير
const redisUrl = process.env.REDIS_URL;
let client = null;
let pubSub = null;

// آلية Fallback للتطوير المحلي إذا لم يكن Redis متاحاً
const localMemory = new Map();
const localSubscribers = new Map();

if (redisUrl) {
  console.log('[Blackboard] Connecting to Redis for Distributed Memory...');
  client = new Redis(redisUrl);
  pubSub = new Redis(redisUrl);
} else {
  console.warn('[Blackboard] WARN: REDIS_URL not set. Falling back to local memory (Not for production).');
}

/**
 * كتابة معرفة/نتيجة في الذاكرة المشتركة
 * @param {string} key - مفتاح المعرفة (مثلاً: agent:intel:threat_level)
 * @param {object} value - القيمة
 * @param {number} ttl - مدة الحياة بالثواني (افتراضياً ساعة)
 */
export async function writeMemory(key, value, ttl = 3600) {
  const data = JSON.stringify({ value, timestamp: Date.now() });
  if (client) {
    await client.set(key, data, 'EX', ttl);
    // نشر حدث يخبر الوكلاء الآخرين بوجود تحديث
    await client.publish('blackboard_updates', key);
  } else {
    localMemory.set(key, data);
    if (localSubscribers.has('blackboard_updates')) {
      localSubscribers.get('blackboard_updates').forEach(cb => cb(key));
    }
  }
}

/**
 * قراءة معرفة من الذاكرة المشتركة
 * @param {string} key
 */
export async function readMemory(key) {
  if (client) {
    const data = await client.get(key);
    return data ? JSON.parse(data).value : null;
  } else {
    const data = localMemory.get(key);
    return data ? JSON.parse(data).value : null;
  }
}

/**
 * الاشتراك في التحديثات (Pub/Sub)
 * @param {function} callback - تُستدعى عند تحديث أي مفتاح
 */
export function subscribeToUpdates(callback) {
  if (pubSub) {
    pubSub.subscribe('blackboard_updates');
    pubSub.on('message', (channel, key) => callback(key));
  } else {
    if (!localSubscribers.has('blackboard_updates')) {
      localSubscribers.set('blackboard_updates', []);
    }
    localSubscribers.get('blackboard_updates').push(callback);
  }
}

/**
 * مسح الذاكرة (للاختبارات)
 */
export async function flushMemory() {
  if (client) {
    await client.flushdb();
  } else {
    localMemory.clear();
  }
}
