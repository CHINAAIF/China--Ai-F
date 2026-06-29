import crypto from 'crypto';
import fs from 'fs';

const WEAK_KEYS = new Set(['default-key-32-chars-minimum!!', '00000000000000000000000000000000', 'changeme-changeme-changeme-change']);

export function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY غير موجود');
  if (key.length < 32) throw new Error('مفتاح قصير');
  if (WEAK_KEYS.has(key)) throw new Error('مفتاح ضعيف');
  return key;
}

export function hashPayload(rawString) {
  return crypto.createHash('sha256').update(rawString, 'utf8').digest('hex');
}

export function signHash(hash, key = getEncryptionKey()) {
  return crypto.createHmac('sha256', key).update(hash).digest('hex');
}

export function hashAndSign(rawString) {
  const key = getEncryptionKey();
  const hash = hashPayload(rawString);
  const signature = signHash(hash, key);
  return { hash, signature };
}

export function verifySignature(hash, signature, key = getEncryptionKey()) {
  const expected = signHash(hash, key);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
