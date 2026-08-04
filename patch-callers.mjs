import fs from 'fs';
import { execSync } from 'child_process';

// البحث عن كل الملفات التي تستدعي getPool باستثناء المحمية والخائنة
const cmd = `grep -rl "getPool(" --include="*.js" --include="*.mjs" . | grep -v node_modules | grep -v "lib/db.js" | grep -v "patch-db.js" | grep -v "trunkia_insider.js" | grep -v "index.js" | grep -v "lib/services/db-pool.js"`;
const filesStr = execSync(cmd, { encoding: 'utf8' });
const files = filesStr.trim().split('\n').filter(Boolean);

let patchedCount = 0;

for (const file of files) {
  let c = fs.readFileSync(file, 'utf8');
  let modified = false;

  // 1. إصلاح الاستيراد لإضافة generateDbToken
  const importRegex = /(import\s+\{)([^}]+)(\}\s+from\s+['"][^'"]+db\.js['"])/;
  const importMatch = c.match(importRegex);
  if (importMatch) {
    let imports = importMatch[2].split(',').map(s => s.trim()).filter(Boolean);
    if (imports.includes('getPool') && !imports.includes('generateDbToken')) {
      imports.push('generateDbToken');
      c = c.replace(importRegex, `$1 ${imports.join(', ')} $3`);
      modified = true;
    }
  }

  // 2. استبدال الاستدعاءات الفارغة أو ذات المعامل الواحد
  const callRegex = /getPool\(([^)]*)\)/g;
  c = c.replace(callRegex, (match, args) => {
    if (args.includes('generateDbToken')) return match; // تم ترقيعها
    const trimmed = args.trim();
    if (trimmed === '') {
      return `getPool('main', generateDbToken('patch-callers.mjs'))`;
    } else if (trimmed.includes(',')) {
      return match; // متعدد المعاملات (تجاهل)
    } else {
      return `getPool(${trimmed}, generateDbToken('patch-callers.mjs'))`;
    }
  });

  if (c.includes('generateDbToken('patch-callers.mjs')') && !modified) {
    modified = true; // في حال كان الاستيراد موجوداً مسبقاً
  }

  if (modified) {
    fs.writeFileSync(file, c, 'utf8');
    console.log(`✅ Patched: ${file}`);
    patchedCount++;
  }
}
console.log(`Done. Patched ${patchedCount} files.`);
