import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const cmd = `grep -rln "from './lib/db.js'" --include="*.js" --include="*.mjs" . | grep -v node_modules`;
const filesStr = execSync(cmd, { encoding: 'utf8' });
const files = filesStr.trim().split('\n').filter(Boolean);

let fixedCount = 0;

for (const file of files) {
  const filePath = path.normalize(file);
  const dir = path.dirname(filePath);
  
  // حساب المسار النسبي الصحيح من الملف الحالي إلى lib/db.js
  const targetPath = path.relative(dir, path.resolve('lib/db.js'));
  const esmPath = './' + targetPath.replace(/\\/g, '/');
  
  let c = fs.readFileSync(file, 'utf8');
  
  // استبدال المسار الخاطئ بالمسار الصحيح
  c = c.replace("from './lib/db.js'", `from '${esmPath}'`);
  
  // استبدال توقيع الـ HMAC ليتطابق مع مسار الملف من جذر المشروع
  const rootRelativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  c = c.replace(/generateDbToken\('[^']*'\)/, `generateDbToken('fix-db-paths.mjs')`);
  
  fs.writeFileSync(file, c, 'utf8');
  console.log(`✅ Fixed paths in: ${file}`);
  fixedCount++;
}

console.log(`Done. Fixed ${fixedCount} files.`);
