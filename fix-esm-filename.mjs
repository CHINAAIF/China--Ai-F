import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const cmd = `grep -rln "generateDbToken('fix-esm-filename.mjs')" --include="*.js" --include="*.mjs" . | grep -v node_modules`;
const filesStr = execSync(cmd, { encoding: 'utf8' });
const files = filesStr.trim().split('\n').filter(Boolean);

let fixedCount = 0;

for (const file of files) {
  const filePath = path.normalize(file);
  let c = fs.readFileSync(file, 'utf8');
  
  // استبدال __filename بمسار الملف النصي من جذر المشروع
  const rootRelativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  c = c.replace(/generateDbToken\(__filename\)/g, `generateDbToken('${rootRelativePath}')`);
  
  fs.writeFileSync(file, c, 'utf8');
  console.log(`✅ Fixed ESM path in: ${file} -> ${rootRelativePath}`);
  fixedCount++;
}

console.log(`Done. Fixed ${fixedCount} files.`);
