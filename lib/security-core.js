import crypto from 'crypto';

/**
 * TRUNKIA Enterprise Security Core
 * Centralized cryptographic operations. No fallbacks, no weak keys.
 */

const WEAK_KEYS = new Set([
  'default-key-32-chars-minimum!!',
  '00000000000000000000000000000000',
  'changeme-changeme-changeme-change',
  '12345678901234567890123456789012'
]);

/**
 * Retrieves and validates the master encryption key.
 * Fails fast if the key is missing, too short, or known to be weak.
 */
export function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('SECURITY FATAL: ENCRYPTION_KEY is not set. System cannot start.');
  }
  if (key.length < 32) {
    throw new Error(`SECURITY FATAL: ENCRYPTION_KEY is too short (${key.length} chars). Minimum is 32.`);
  }
  if (WEAK_KEYS.has(key)) {
    throw new Error('SECURITY FATAL: ENCRYPTION_KEY is a known weak/default key. Refusing to operate.');
  }
  return key;
}

/**
 * Hashes a payload using SHA-256.
 * @param {string} rawString 
 * @returns {string} hex digest
 */
export function hashPayload(rawString) {
  if (typeof rawString !== 'string') throw new Error('Invalid payload type for hashing.');
  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

/**
 * Signs a hash using HMAC-SHA256 with the master key.
 * @param {string} hash 
 * @returns {string} hex digest
 */
export function signHash(hash) {
  const key = getEncryptionKey();
  return crypto.createHmac('sha256', key).update(hash).digest('hex');
}

/**
 * Verifies a signature using timing-safe comparison to prevent timing attacks.
 * @param {string} hash 
 * @param {string} signature 
 * @returns {boolean}
 */
export function verifySignature(hash, signature) {
  if (typeof hash !== 'string' || typeof signature !== 'string') return false;
  const expectedSignature = signHash(hash);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  
  if (expectedBuffer.length !== providedBuffer.length) return false;
  
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
