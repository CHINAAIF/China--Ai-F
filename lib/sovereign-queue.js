/**
 * TRUNKIA Sovereign Queue v2.1 (Omega Protocol - Distributed Core)
 * 
 * Production: Redis Streams (Consumer Groups, XAUTOCLAIM, DLQ)
 * Staging: In-Memory Stream Engine (identical semantics)
 */

import crypto from 'crypto';
import logger from './services/sovereign-logger.js';

// =====================================================
// IN-MEMORY STREAM ENGINE (Staging/Test Double)
// Mimics Redis Streams response formats exactly.
// =====================================================
class InMemoryStream {
  constructor() {
    this.streams = new Map(); // streamName -> [{ id, fieldsArray }]
    this.groups = new Map();  // `stream:group` -> { pending: Map, delivered: Set }
    this.counter = 0;
  }

  _ensureStream(name) {
    if (!this.streams.has(name)) this.streams.set(name, []);
    return this.streams.get(name);
  }

  async xadd(stream, ...args) {
    const entries = this._ensureStream(stream);
    const id = `${Date.now()}-${++this.counter}`;
    // Find the ID marker '*' and parse field-value pairs after it
    const idIdx = args.indexOf('*');
    const fieldsArray = idIdx !== -1 ? args.slice(idIdx + 1) : [];
    entries.push({ id, fieldsArray });
    return id;
  }

  async xgroup(cmd, stream, group, id, mkstream) {
    if (cmd !== 'CREATE') throw new Error('Unsupported XGROUP cmd');
    this._ensureStream(stream);
    const key = `${stream}:${group}`;
    if (this.groups.has(key)) throw new Error('BUSYGROUP');
    this.groups.set(key, { pending: new Map(), delivered: new Set() });
    return 'OK';
  }

  async xreadgroup(cmd, group, consumer, countKey, count, blockKey, blockMs, streamsKey, stream, startId) {
    const key = `${stream}:${group}`;
    const g = this.groups.get(key);
    if (!g) return null;
    const entries = this.streams.get(stream) || [];
    const result = [];
    
    for (const entry of entries) {
      // '>' means only new messages never delivered to this group
      if (startId === '>' && !g.delivered.has(entry.id)) {
        g.delivered.add(entry.id);
        g.pending.set(entry.id, { consumer, deliveredAt: Date.now(), deliveries: 1 });
        result.push([entry.id, entry.fieldsArray]);
        if (result.length >= count) break;
      }
    }
    return result.length > 0 ? [[stream, result]] : null;
  }

  async xack(stream, group, id) {
    const key = `${stream}:${group}`;
    const g = this.groups.get(key);
    if (!g) return 0;
    return g.pending.delete(id) ? 1 : 0;
  }

  async xautoclaim(stream, group, consumer, minIdleMs, startId, countKey, count) {
    const key = `${stream}:${group}`;
    const g = this.groups.get(key);
    if (!g) return [null, []];
    const now = Date.now();
    const claimed = [];
    
    for (const [id, info] of g.pending) {
      if (now - info.deliveredAt > minIdleMs) {
        info.consumer = consumer;
        info.deliveredAt = now;
        info.deliveries++;
        const entry = (this.streams.get(stream) || []).find(e => e.id === id);
        if (entry) claimed.push([id, entry.fieldsArray]);
        if (claimed.length >= count) break;
      }
    }
    return [null, claimed];
  }

  async xpending(stream, group) {
    const key = `${stream}:${group}`;
    const g = this.groups.get(key);
    if (!g) return [0];
    return [g.pending.size];
  }

  async xlen(stream) {
    return (this.streams.get(stream) || []).length;
  }
}

// =====================================================
// SOVEREIGN QUEUE
// =====================================================
class SovereignQueue {
  constructor() {
    this.streamName = 'trunkia:stream';
    this.groupName = 'trunkia-workers';
    this.dlqStream = 'trunkia:dlq';
    this.MAX_STREAM_LEN = 100000;
    this.MAX_DELIVERIES = 3;

    if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
      const { createRequire } = require('module');
      const req = createRequire(import.meta.url);
      const Redis = req('ioredis');
      this.redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
      this.redis.on('connect', () => logger.info('Queue: Redis connected (Production mode)'));
      this.redis.on('error', (e) => logger.error('Queue: Redis error', { error: e.message }));
      this._initGroup();
    } else {
      this.redis = new InMemoryStream();
      logger.info('Queue: In-Memory Engine active (Staging mode)');
      this._initGroup();
    }
  }

  async _initGroup() {
    try {
      await this.redis.xgroup('CREATE', this.streamName, this.groupName, '$', 'MKSTREAM');
    } catch (err) {
      if (!err.message.includes('BUSYGROUP')) {
        logger.error('Queue: Failed to init consumer group', { error: err.message });
      }
    }
  }

  async enqueue(jobData) {
    const jobId = crypto.randomUUID();
    try {
      await this.redis.xadd(this.streamName, 'MAXLEN', '~', this.MAX_STREAM_LEN, '*',
        'jobId', jobId, 'payload', JSON.stringify(jobData), 'status', 'PENDING',
        'deliveries', '0', 'createdAt', Date.now().toString());
      return jobId;
    } catch (err) {
      logger.error('Queue: Enqueue failed', { jobId, error: err.message });
      throw new Error('QUEUE_ENQUEUE_FAILED');
    }
  }

  async dequeue(consumerName, count = 1, blockMs = 5000) {
    try {
      const result = await this.redis.xreadgroup('GROUP', this.groupName, consumerName,
        'COUNT', count, 'BLOCK', blockMs, 'STREAMS', this.streamName, '>');
      if (!result) return [];
      
      const messages = [];
      for (const [stream, entries] of result) {
        for (const [id, fields] of entries) {
          const obj = { id };
          // fields is an array like ['jobId', '123', 'payload', '...']
          for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]] = fields[i + 1];
          }
          messages.push(obj);
        }
      }
      return messages;
    } catch (err) {
      logger.error('Queue: Dequeue failed', { error: err.message });
      return [];
    }
  }

  async ack(messageId) {
    try {
      const res = await this.redis.xack(this.streamName, this.groupName, messageId);
      return res === 1 || res === true;
    } catch (err) {
      logger.error('Queue: ACK failed', { messageId, error: err.message });
      return false;
    }
  }

  async reclaimStuckJobs(consumerName, minIdleTimeMs = 1000) {
    try {
      const result = await this.redis.xautoclaim(this.streamName, this.groupName,
        consumerName, minIdleTimeMs, '0', 'COUNT', 10);
        
      if (!result || !result[1] || result[1].length === 0) return [];

      const messages = [];
      for (const [id, fields] of result[1]) {
        const obj = { id };
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        
        let deliveries = parseInt(obj.deliveries || '0', 10) + 1;
        obj.deliveries = deliveries.toString();
        
        if (deliveries > this.MAX_DELIVERIES) {
          await this.moveToDLQ(id, obj, 'MAX_DELIVERIES_EXCEEDED');
        } else {
          messages.push(obj);
        }
      }
      if (messages.length > 0) logger.warn('Queue: Reclaimed stuck jobs', { count: messages.length });
      return messages;
    } catch (err) {
      logger.error('Queue: Reclaim failed', { error: err.message });
      return [];
    }
  }

  async moveToDLQ(messageId, message, reason) {
    try {
      await this.redis.xadd(this.dlqStream, '*',
        'originalId', messageId, 'jobId', message.jobId || 'unknown',
        'payload', message.payload || '{}', 'reason', reason,
        'deliveries', message.deliveries || '0', 'failedAt', Date.now().toString());
      await this.redis.xack(this.streamName, this.groupName, messageId);
      logger.error('Queue: Message moved to DLQ', { messageId, jobId: message.jobId, reason });
    } catch (err) {
      logger.error('Queue: DLQ move failed', { messageId, error: err.message });
    }
  }

  async getStats() {
    try {
      const pending = await this.redis.xpending(this.streamName, this.groupName);
      const dlqLen = await this.redis.xlen(this.dlqStream);
      return { pending: pending[0] || 0, dlq: dlqLen || 0, stream: this.streamName, group: this.groupName };
    } catch (e) {
      return { error: e.message };
    }
  }
}

const queue = new SovereignQueue();
export const sovereignQueue = queue;
export default sovereignQueue;
