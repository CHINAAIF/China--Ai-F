import fs from 'fs';
const f = 'lib/semantic-cache.js';
let c = fs.readFileSync(f, 'utf8');

// 1. Fix Timing Attack Vulnerability (Side-Channel Expert #21)
c = c.replace(
  "return expectedSig === finalBlock.signature; // Constant-time comparison can be added for extra paranoia",
  "try {\n      const a = Buffer.from(expectedSig, 'hex');\n      const b = Buffer.from(finalBlock.signature, 'hex');\n      return a.length === b.length && crypto.timingSafeEqual(a, b);\n    } catch (e) { return false; }"
);

// 2. Fix Entropy Collision (Shannon Entropy Expert #17)
c = c.replace(
  "const normalized = prompt.normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, '');",
  "const normalized = prompt.normalize('NFKC').toLowerCase().replace(/[\\s\\u200B-\\u200D\\uFEFF]+/g, ' ').trim();"
);

fs.writeFileSync(f, c, 'utf8');
console.log('✅ Patched semantic-cache.js (Timing Attack & Entropy Collision Fixed)');
