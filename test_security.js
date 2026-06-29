import { hashAndSign, verifySignature } from './security-core.js';
process.env.ENCRYPTION_KEY = 'a-very-long-and-secure-random-key-32-chars-minimum!!';
try {
  const { hash, signature } = hashAndSign("Test Data");
  if(verifySignature(hash, signature)) {
      process.exit(0);
  } else {
      process.exit(1);
  }
} catch (e) {
  process.exit(1);
}
