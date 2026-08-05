// ============================================================================
// TRUNKIA (VIGILANT-H) - HARDENED SECURITY CORE (ESM MODULE)
// ============================================================================
import crypto from 'crypto';

export const HARDENED_DB_CONFIG = Object.freeze({
    connectionLimit: 1,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

export class SovereignMemoryStore {
    constructor(ttlMs = 300000) {
        this.store = new Map();
        this.ttl = ttlMs;
    }

    set(key, value) {
        const hashKey = crypto.createHash('sha256').update(key).digest('hex');
        const expiresAt = Date.now() + this.ttl;
        this.store.set(hashKey, { data: value, expiresAt });
        return hashKey;
    }

    hasAndConsume(key) {
        const hashKey = crypto.createHash('sha256').update(key).digest('hex');
        const entry = this.store.get(hashKey);
        if (!entry) return false;
        
        if (Date.now() > entry.expiresAt) {
            this.store.delete(hashKey);
            return false;
        }
        
        this.store.delete(hashKey);
        return true;
    }
}

export function sanitizePayload(rawBody) {
    if (!rawBody || typeof rawBody !== 'object') {
        throw new Error("INVALID_PAYLOAD_FORMAT");
    }

    const payloadString = JSON.stringify(rawBody);
    const byteSize = Buffer.byteLength(payloadString, 'utf8');

    if (byteSize > 51200) {
        throw new Error("PAYLOAD_SIZE_EXCEEDED");
    }

    const sanitizedString = payloadString.replace(/[\u200B-\u200D\uFEFF]/g, '');
    return JSON.parse(sanitizedString);
}
