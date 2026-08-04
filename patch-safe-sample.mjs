import fs from 'fs';
import crypto from 'crypto';
const f = 'lib/semantic-cache.js';
let c = fs.readFileSync(f, 'utf8');

if (!c.includes('getSafeSample')) {
  c = c.replace(
    "getStats() {",
    `getSafeSample(size = 20) {
    const values = Array.from(this.cache.values()).slice(-size);
    // Security: Return hashed fingerprints and lengths, NOT raw content (Prevents Cross-Tenant Leakage)
    return values.map(v => {
      const content = v.response?.content || '';
      return {
        hash: crypto.createHash('sha256').update(content).digest('hex').substring(0, 16),
        length: content.length,
        tokens: v.tokens || 0
      };
    });
  }

  getStats() {`
  );
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched semantic-cache.js (Safe Sample: Hashed, no raw content)');
} else {
  console.log('⚠️ getSafeSample already exists.');
}
