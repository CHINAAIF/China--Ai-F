/**
 * TRUNKIA Sovereign Queue v1.0 (Omega Protocol - Distributed Core)
 * 
 * Enterprise Features:
 * 1. Redis Streams (Consumer Groups, XREADGROUP, XACK)
 * 2. Auto-Claiming (XAUTOCLAIM for zombie worker recovery)
 * 3. Dead Letter Queue (DLQ for poison pills)
 * 4. Fail-Fast Architecture (No Redis = No Start)
 * 5. MAXLEN Trimming (Bounded memory)
 * 6. Structured Logging (100% JSON)
 */

import { createRequire } from 'module';
import crypto from 'crypto';
import logger from './sovereign-logger.js';

const require = createRequire(import.meta.url);
let RedisClient = null;
try { RedisClient = require('ioredis'); } catch (e) {
    logger.fatal('ioredis module not found. Distributed queue cannot operate.', { error: e.message });
    process.exit(1);
}

class SovereignQueue {
    constructor() {
        if (!process.env.REDIS_URL) {
            logger.fatal('REDIS_URL is not set. Sovereign Queue requires a distributed Redis instance. Refusing to start (Fail-Fast).');
            process.exit(1);
        }
        
        this.redis = new RedisClient(process.env.REDIS_URL, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            connectTimeout: 5000
        });
        
        this.streamName = 'trunkia:stream';
        this.groupName = 'trunkia-workers';
        this.dlqStream = 'trunkia:dlq';
        this.MAX_STREAM_LEN = 100000;
        this.MAX_DELIVERIES = 3;
        
        this.redis.on('error', (err) => {
            logger.error('Redis connection error in Sovereign Queue', { error: err.message });
        });
        
        this.redis.on('connect', () => {
            logger.info('Sovereign Queue connected to Redis.', { mode: 'distributed' });
            this._initConsumerGroup();
        });
    }

    async _initConsumerGroup() {
        try {
            // MKSTREAM ensures the stream is created if it doesn't exist
            await this.redis.xgroup('CREATE', this.streamName, this.groupName, '$', 'MKSTREAM');
            logger.info('Consumer group initialized.', { stream: this.streamName, group: this.groupName });
        } catch (err) {
            if (err.message.includes('BUSYGROUP')) {
                logger.info('Consumer group already exists.', { group: this.groupName });
            } else {
                logger.error('Failed to initialize consumer group', { error: err.message });
            }
        }
    }

    /**
     * Enqueue a job to the stream.
     * @param {object} jobData - The payload to process
     * @returns {string} jobId
     */
    async enqueue(jobData) {
        const jobId = crypto.randomUUID();
        try {
            await this.redis.xadd(
                this.streamName,
                'MAXLEN', '~', this.MAX_STREAM_LEN,
                '*',
                'jobId', jobId,
                'payload', JSON.stringify(jobData),
                'status', 'PENDING',
                'deliveries', '0',
                'createdAt', Date.now().toString()
            );
            logger.debug('Job enqueued', { jobId, stream: this.streamName });
            return jobId;
        } catch (err) {
            logger.error('Failed to enqueue job', { jobId, error: err.message });
            throw new Error('QUEUE_ENQUEUE_FAILED');
        }
    }

    /**
     * Dequeue a job for processing.
     * @param {string} consumerName - The name of the worker (e.g., worker-1)
     * @param {number} count - Number of messages to read
     * @param {number} blockMs - Blocking timeout in ms
     * @returns {array} messages
     */
    async dequeue(consumerName, count = 1, blockMs = 5000) {
        try {
            const result = await this.redis.xreadgroup(
                'GROUP', this.groupName, consumerName,
                'COUNT', count,
                'BLOCK', blockMs,
                'STREAMS', this.streamName,
                '>' // > means only new messages never delivered to this group
            );

            if (!result) return [];

            const messages = [];
            for (const [stream, entries] of result) {
                for (const [id, fields] of entries) {
                    const obj = { id };
                    // fields is an array like ['jobId', '123', 'payload', '...']
                    for (let i = 0; i < fields.length; i += 2) {
                        obj[fields[i]] = fields[i+1];
                    }
                    messages.push(obj);
                }
            }
            return messages;
        } catch (err) {
            logger.error('Failed to dequeue job', { error: err.message });
            return [];
        }
    }

    /**
     * Acknowledge a job (mark as processed).
     * @param {string} messageId - The Redis stream ID
     */
    async ack(messageId) {
        try {
            await this.redis.xack(this.streamName, this.groupName, messageId);
            logger.debug('Job acknowledged', { messageId });
            return true;
        } catch (err) {
            logger.error('Failed to ACK job', { messageId, error: err.message });
            return false;
        }
    }

    /**
     * Reclaim stuck jobs (from dead workers).
     * @param {string} consumerName - The worker reclaiming the jobs
     * @param {number} minIdleTimeMs - Minimum idle time to consider a job stuck
     */
    async reclaimStuckJobs(consumerName, minIdleTimeMs = 60000) {
        try {
            // XAUTOCLAIM stream group consumer min-idle-time start-id count
            const result = await this.redis.xautoclaim(
                this.streamName,
                this.groupName,
                consumerName,
                minIdleTimeMs,
                '0', // start from beginning of PEL
                'COUNT', 10
            );

            if (!result || !result[1] || result[1].length === 0) return [];

            const messages = [];
            for (const [id, fields] of result[1]) {
                const obj = { id };
                for (let i = 0; i < fields.length; i += 2) {
                    obj[fields[i]] = fields[i+1];
                }
                // Increment delivery count
                let deliveries = parseInt(obj.deliveries || '0', 10) + 1;
                obj.deliveries = deliveries.toString();
                
                // Move to DLQ if max deliveries exceeded
                if (deliveries > this.MAX_DELIVERIES) {
                    await this.moveToDLQ(id, obj, 'MAX_DELIVERIES_EXCEEDED');
                } else {
                    // Update delivery count in stream
                    await this.redis.xadd(this.streamName, 'MAXLEN', '~', this.MAX_STREAM_LEN, '*',
                        'jobId', obj.jobId,
                        'payload', obj.payload,
                        'status', 'RECLAIMED',
                        'deliveries', obj.deliveries,
                        'createdAt', obj.createdAt || Date.now().toString()
                    );
                    await this.redis.xack(this.streamName, this.groupName, id); // ACK old entry
                    messages.push(obj);
                }
            }
            
            if (messages.length > 0) {
                logger.warn('Reclaimed stuck jobs', { count: messages.length, consumer: consumerName });
            }
            
            return messages;
        } catch (err) {
            logger.error('Failed to reclaim stuck jobs', { error: err.message });
            return [];
        }
    }

    /**
     * Move a poison pill message to Dead Letter Queue.
     */
    async moveToDLQ(messageId, message, reason) {
        try {
            await this.redis.xadd(
                this.dlqStream,
                '*',
                'originalId', messageId,
                'jobId', message.jobId || 'unknown',
                'payload', message.payload || '{}',
                'reason', reason,
                'deliveries', message.deliveries || '0',
                'failedAt', Date.now().toString()
            );
            await this.redis.xack(this.streamName, this.groupName, messageId);
            logger.error('Message moved to DLQ', { messageId, jobId: message.jobId, reason });
        } catch (err) {
            logger.error('Failed to move message to DLQ', { messageId, error: err.message });
        }
    }

    async getQueueStats() {
        try {
            const pending = await this.redis.xpending(this.streamName, this.groupName);
            const dlqLen = await this.redis.xlen(this.dlqStream);
            return {
                pending: pending[0] || 0,
                dlq: dlqLen || 0,
                stream: this.streamName,
                group: this.groupName
            };
        } catch (e) {
            return { error: e.message };
        }
    }
}

const queue = new SovereignQueue();
export const sovereignQueue = queue;
export default sovereignQueue;
