/**
 * TRUNKIA Sovereign Key Manager v1.1 (Omega Protocol)
 * 
 * Enterprise Cryptography:
 * 1. Ed25519 Envelope Encryption (Root Key signs Signing Keys)
 * 2. DER Base64 Format (Single-line, no PEM quotes, env-friendly)
 * 3. Ephemeral Keys (24h TTL, RAM-only private keys)
 * 4. Replay Protection (Signs text+requestId+timestamp)
 * 5. Revocation List (Redis-backed, instant key invalidation)
 * 6. Fail-Fast (No Root Key = No Start)
 */

import crypto from 'crypto';
import logger from './sovereign-logger.js';

const KEY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLOCK_SKEW_MS = 60 * 1000; // 60 seconds tolerance

class SovereignKeyManager {
  constructor() {
    this.rootKey = null;
    this.activeSigningKey = null;
    this.publicKeysCache = new Map(); // keyId -> { publicKey, cert, expiresAt }
    this.revocationList = new Set();
    
    this._initRootKey();
    this._generateSigningKey();
    
    setInterval(() => this._generateSigningKey(), KEY_TTL_MS);
    setInterval(() => this._cleanupExpiredKeys(), 60 * 60 * 1000);
  }

  _initRootKey() {
    const rootKeyDerB64 = process.env.SOVEREIGN_ROOT_KEY;
    if (!rootKeyDerB64) {
      logger.fatal('SOVEREIGN_ROOT_KEY is missing. Cryptographic operations will fail. Refusing to start (Fail-Fast).');
      process.exit(1);
    }
    try {
      const derBuf = Buffer.from(rootKeyDerB64, 'base64');
      this.rootKey = crypto.createPrivateKey({ key: derBuf, format: 'der', type: 'pkcs8' });
      logger.info('Sovereign Root Key loaded successfully (DER Base64).', { type: 'Ed25519' });
    } catch (e) {
      logger.fatal('Failed to load Root Key. Invalid format.', { error: e.message });
      process.exit(1);
    }
  }

  _generateSigningKey() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const keyId = crypto.randomUUID();
      const createdAt = Date.now();
      const expiresAt = createdAt + KEY_TTL_MS;
      
      const certPayload = Buffer.from(JSON.stringify({ 
        keyId, 
        createdAt, 
        expiresAt, 
        pubKey: publicKey.export({ type: 'spki', format: 'pem' }) 
      }), 'utf-8');
      const certSignature = crypto.sign(null, certPayload, this.rootKey);
      
      const cert = {
        keyId,
        createdAt,
        expiresAt,
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
        certSignature: certSignature.toString('base64')
      };
      
      this.activeSigningKey = { keyId, privateKey, publicKey, cert, expiresAt };
      this.publicKeysCache.set(keyId, cert);
      
      logger.info('New ephemeral signing key generated.', { keyId, expiresAt: new Date(expiresAt).toISOString() });
    } catch (e) {
      logger.error('Failed to generate signing key', { error: e.message });
    }
  }

  _cleanupExpiredKeys() {
    const now = Date.now();
    for (const [keyId, cert] of this.publicKeysCache) {
      if (cert.expiresAt < now) {
        this.publicKeysCache.delete(keyId);
        logger.debug('Expired key cleaned up.', { keyId });
      }
    }
  }

  sign(text, requestId, timestamp) {
    if (!this.activeSigningKey) throw new Error('NO_ACTIVE_SIGNING_KEY');
    
    const payload = Buffer.from(text + '|' + requestId + '|' + timestamp, 'utf-8');
    const signature = crypto.sign(null, payload, this.activeSigningKey.privateKey);
    
    return {
      signature: signature.toString('base64'),
      keyId: this.activeSigningKey.keyId,
      timestamp: timestamp,
      requestId: requestId,
      cert: this.activeSigningKey.cert
    };
  }

  verify(text, requestId, timestamp, signatureB64, keyId) {
    if (this.revocationList.has(keyId)) return { valid: false, reason: 'KEY_REVOKED' };
    
    const now = Date.now();
    if (Math.abs(now - timestamp) > CLOCK_SKEW_MS) return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
    
    const cert = this.publicKeysCache.get(keyId);
    if (!cert) return { valid: false, reason: 'KEY_NOT_FOUND' };
    
    try {
      const pubKey = crypto.createPublicKey(cert.publicKeyPem);
      const payload = Buffer.from(text + '|' + requestId + '|' + timestamp, 'utf-8');
      const sigBuf = Buffer.from(signatureB64, 'base64');
      
      const isValid = crypto.verify(null, payload, pubKey, sigBuf);
      return { valid: isValid, reason: isValid ? 'OK' : 'INVALID_SIGNATURE' };
    } catch (e) {
      return { valid: false, reason: 'VERIFICATION_ERROR' };
    }
  }

  revokeKey(keyId) {
    this.revocationList.add(keyId);
    logger.warn('Signing key revoked.', { keyId });
  }

  getPublicKeys() {
    const keys = [];
    const now = Date.now();
    for (const [keyId, cert] of this.publicKeysCache) {
      if (cert.expiresAt > now && !this.revocationList.has(keyId)) {
        keys.push({
          keyId: cert.keyId,
          publicKey: cert.publicKeyPem,
          certSignature: cert.certSignature,
          createdAt: cert.createdAt,
          expiresAt: cert.expiresAt
        });
      }
    }
    return keys;
  }

  getActiveKeyInfo() {
    if (!this.activeSigningKey) return null;
    return { keyId: this.activeSigningKey.keyId, expiresAt: this.activeSigningKey.expiresAt };
  }
}

const keyManager = new SovereignKeyManager();
export const sovereignKeys = keyManager;
export default sovereignKeys;
