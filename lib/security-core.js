import crypto from 'crypto';

/**
 * TRUNKIA Enterprise Security Core
 * Implements AES-256-GCM for data-at-rest encryption and HMAC-SHA256 for integrity.
 * No fallbacks, no weak keys.
 */

const WEAK_KEYS = new Set([
  'default-key-32-chars-minimum!!',
  '00000000000000000000000000000000',
  'changeme-changeme-changeme-change',
  '12345678901234567890123456789012'
]);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Retrieves and validates the master encryption key.
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
  return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8'); // Ensure 32-byte buffer
}

/**
 * Hashes a payload using SHA-256.
 */
export function hashPayload(rawString) {
  if (typeof rawString !== 'string') throw new Error('Invalid payload type for hashing.');
  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

/**
 * Signs a hash using HMAC-SHA256 with the master key.
 */
export function signHash(hash) {
  const key = getEncryptionKey();
  return crypto.createHmac('sha256', key).update(hash).digest('hex');
}

/**
 * Verifies a signature using timing-safe comparison to prevent timing attacks.
 */
export function verifySignature(hash, signature) {
  if (typeof hash !== 'string' || typeof signature !== 'string') return false;
  const expectedSignature = signHash(hash);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a formatted string: base64(iv) : base64(tag) : base64(ciphertext)
 */
export function encrypt(text) {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  
  return [iv.toString('base64'), tag.toString('base64'), encrypted].join(':');
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Expects formatted string: base64(iv) : base64(tag) : base64(ciphertext)
 */
export function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') return null;
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('SECURITY: Invalid encrypted format. Expected iv:tag:ciphertext.');
  }
  
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
