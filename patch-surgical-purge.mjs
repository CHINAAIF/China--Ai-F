import fs from 'fs';
const f = 'agents/system/cognitive-drift-agent.js';
let c = fs.readFileSync(f, 'utf8');

// Add crypto import
if (!c.includes("import crypto from 'crypto';")) {
  c = c.replace("import { writeMemory, readMemory } from '../../lib/blackboard.js';", "import { writeMemory, readMemory } from '../../lib/blackboard.js';\nimport crypto from 'crypto';");
}

// Replace Blind Purge with Surgical Purge
const oldPurge = `// Fix #2: Targeted Purge (not full flush)
          // We flush only the recent contaminated entries (last 20)
          const allKeys = Array.from(semanticCache.cache.keys());
          const recentKeys = allKeys.slice(-20);
          recentKeys.forEach(k => semanticCache.cache.delete(k));
          console.warn(\`[CognitiveDrift] Purged \${recentKeys.length} contaminated entries.\`);`;

const newPurge = `// Surgical Purge: Delete ONLY duplicate hashes, keep unique entries
          const entries = Array.from(semanticCache.cache.entries());
          const seenHashes = new Set();
          let purgedCount = 0;
          for (const [key, val] of entries) {
            const content = val.response?.content || '';
            const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
            if (seenHashes.has(hash)) {
              semanticCache.cache.delete(key);
              purgedCount++;
            } else {
              seenHashes.add(hash);
            }
          }
          console.warn(\`[CognitiveDrift] Surgical Purge: Removed \${purgedCount} duplicate entries. Kept \${seenHashes.size} unique entries.\`);`;

if (c.includes(oldPurge)) {
  c = c.replace(oldPurge, newPurge);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ Patched cognitive-drift-agent.js (Surgical Purge)');
} else {
  console.log('❌ Could not find old purge logic.');
}
