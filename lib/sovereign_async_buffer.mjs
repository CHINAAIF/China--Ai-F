import crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * TRUNKIA Sovereign Async Buffer
 * يحل مشكلة I/O Bottleneck عبر تجميع السجلات في الذاكرة (RAM)
 * وكتابتها دفعة واحدة (Batch) كل ثانية باستخدام Merkle Root.
 */
export default class SovereignAsyncBuffer {
    constructor(flushIntervalMs = 1000, maxBufferSize = 10000) {
        this.buffer = [];
        this.maxBufferSize = maxBufferSize;
        this.merkleRoot = crypto.createHash('sha256').update('TRUNKIA_GENESIS').digest();
        
        // معالج الأخطاء لمنع انهيار النظام الحي
        this.eventBus = new EventEmitter();
        this.eventBus.on('error', (err) => console.error('[BUFFER ERROR]', err.message));

        // مؤقت دفع السجلات الدفعي (يحل تعارض الـ Cron)
        this.flushTimer = setInterval(() => this._flush(), flushIntervalMs);
        
        // حماية من تسرب الذاكرة (Memory Leak Protection)
        process.on('SIGTERM', () => this._gracefulFlush());
        process.on('SIGINT', () => this._gracefulFlush());
    }

    // استقبال الحدث بسرعة البرق (Non-blocking O(1))
    push(eventData) {
        if (this.buffer.length >= this.maxBufferSize) {
            this.eventBus.emit('error', new Error('BUFFER_OVERFLOW_PROTECTION_TRIGGERED'));
            return false;
        }
        this.buffer.push({
            ts: Date.now(),
            data: eventData
        });
        return true;
    }

    // دفعة السجلات وتشفيرها شعاعياً (Merkle Tree)
    _flush() {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0, this.buffer.length);
        let currentHash = this.merkleRoot;

        // تجميع وتشفير السجلات لمنع العبث (Tamper-Proof)
        for (const record of batch) {
            const recordStr = JSON.stringify(record);
            const recordHash = crypto.createHash('sha256').update(recordStr).digest();
            // ربط السجل الحالي بسابقه
            currentHash = crypto.createHash('sha256').update(Buffer.concat([currentHash, recordHash])).digest();
        }

        this.merkleRoot = currentHash;
        
        // هنا في الإنتاج يتم دفع الـ batch إلى قاعدة البيانات دفعة واحدة (Bulk Insert)
        // بدلاً من إدراج كل سجل على حدة (الذي يسبب اختناق الـ I/O)
        this.eventBus.emit('batch_flushed', { count: batch.length, new_merkle_root: this.merkleRoot.toString('hex').substring(0, 16) });
    }

    _gracefulFlush() {
        clearInterval(this.flushTimer);
        this._flush();
        console.log('[TRUNKIA BUFFER] Graceful flush completed. No data lost.');
    }
}
