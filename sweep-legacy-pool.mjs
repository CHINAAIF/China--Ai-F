import fs from 'fs';
import { execSync } from 'child_process';

// البحث عن كل الملفات التي تستورد pool من db.js
const cmd = "grep -rln \"import.*pool.*from.*db.js\" --include=\"*.js\" --include=\"*.mjs\" . | grep -v node_modules | grep -v \"lib/db.js\"";
const filesStr = execSync(cmd, { encoding: 'utf8' });
const files = filesStr.trim().split('\n').filter(Boolean);

let patchedCount = 0;

for (const file of files) {
  let c = fs.readFileSync(file, 'utf8');
  let modified = false;

  // استبدال استيراد pool بـ getPool و generateDbToken
  const importRegex = /import\s+\{\s*pool\s*\}\s+from\s+['"][^'"]+db\.js['"]/;
  if (importRegex.test(c)) {
    const relativePath = file.replace('./', '').replace(/\\/g, '/');
    c = c.replace(importRegex, `import { getPool, generateDbToken } from './lib/db.js';\nconst pool = getPool('main', generateDbToken('sweep-legacy-pool.mjs'));`);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(file, c, 'utf8');
    console.log(`✅ Swept and Patched: ${file}`);
    patchedCount++;
  }
}

if (patchedCount === 0) {
  console.log("No legacy pool imports found.");
} else {
  console.log(`Done. Patched ${patchedCount} files with legacy imports.`);
}
