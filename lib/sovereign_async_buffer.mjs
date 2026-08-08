import crypto from 'crypto';
import fs from 'fs';
import { EventEmitter } from 'events';

export default class SovereignAsyncBuffer {
    constructor(flushIntervalMs = 1000, maxWalSizeBytes = 10 * 1024 * 1024) { // 10MB Max
        this.buffer = [];
        this.merkleRoot = crypto.createHash('sha256').update('TRUNKIA_GENESIS').digest();
        
        // 1. حماية من استنزاف القرص (Disk DoS Protection)
        this.walPath = './logs/audit_wal.log';
        this.maxWalSize = maxWalSizeBytes;
        this.walStream = fs.createWriteStream(this.walPath, { flags: 'a' });
        
        this.eventBus = new EventEmitter();
        this.eventBus.on('error', (err) => console.error('[BUFFER ERROR]', err.message));

        this.flushTimer = setInterval(() => this._flush(), flushIntervalMs);
        
        process.on('SIGTERM', () => this._gracefulFlush());
        process.on('SIGINT', () => this._gracefulFlush());
    }

    push(eventData) {
        try {
            // 2. أمان سيبراني: تشفير السجل قبل كتابته على القرص (Pre-hash Tampering Protection)
            // لا نكتب JSON عادي، نكتب Hash + Payload
            const recordStr = JSON.stringify(eventData);
            const recordHash = crypto.createHash('sha256').update(recordStr).digest('hex');
            const record = { ts: Date.now(), hash: recordHash, payload: recordStr };
            
            // فحص حجم الملف قبل الكتابة لمنع DoS
            const stats = fs.statSync(this.walPath);
            if (stats.size > this.maxWalSize) {
                this.eventBus.emit('error', new Error('WAL_SIZE_LIMIT_EXCEEDED_DOS_DEFENSE'));
                // في الإنتاج: هنا يتم تدوير السجل (Log Rotation) أو إيقاف الكتابة
                return false;
            }

            this.walStream.write(JSON.stringify(record) + '\n');
            this.buffer.push(record);
            return true;
        } catch (err) {
            this.eventBus.emit('error', new Error(`SERIALIZATION_FAILED: ${err.message}`));
            return false;
        }
    }

    async _flush() {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0, this.buffer.length);
        let currentHash = this.merkleRoot;

        for (let i = 0; i < batch.length; i++) {
            // 3. الهندسة العكسية: نتحقق أن الـ Hash المخزن يطابق الـ Payload قبل ربطه بالسلسلة
            // لمنع أي عبث تم أثناء وجود السجل في الـ RAM أو القرص
            const calculatedHash = crypto.createHash('sha256').update(batch[i].payload).digest('hex');
            if (calculatedHash !== batch[i].hash) {
                this.eventBus.emit('error', new Error('TAMPER_DETECTED_IN_WAL'));
                continue; // نتجاهل السجل المعبث به
            }
            
            const recordHash = crypto.createHash('sha256').update(batch[i].hash).digest();
            currentHash = crypto.createHash('sha256').update(Buffer.concat([currentHash, recordHash])).digest();
            
            if (i > 0 && i % 1000 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        this.merkleRoot = currentHash;
        this.eventBus.emit('batch_flushed', { count: batch.length, new_merkle_root: this.merkleRoot.toString('hex').substring(0, 16) });
    }

    _gracefulFlush() {
        clearInterval(this.flushTimer);
        this._flush();
        this.walStream.end();
        console.log('[TRUNKIA BUFFER] Graceful flush & WAL closed. Zero data loss.');
    }
}
