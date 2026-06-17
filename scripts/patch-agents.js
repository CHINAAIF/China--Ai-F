import dotenv from 'dotenv';
dotenv.config();
import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const BASE = '/data/data/com.termux/files/home/downloads/China--Ai-F/agents';

// ── الوكلاء الـstandalone لا نلمسهم ────────────────────────────
const SKIP = [
  'intelligence/china-news-agent.js',
  'intelligence/pricing-tracker-agent.js',
  'governance/verification-agent.js',
  'worker-scheduler.js',
  'registry.js',
  'brain.js',
  'index.js',
];

const UTILS_SKIP = ['utils/'];

async function scanAll(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await scanAll(full));
    else if (e.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const stats = { patched: 0, skipped: 0, errors: 0 };

async function patchFile(fullPath) {
  const rel = fullPath.replace(BASE + '/', '');

  // تخطي الـstandalone والـutils
  if (SKIP.some(s => rel.endsWith(s))) { stats.skipped++; return; }
  if (UTILS_SKIP.some(s => rel.includes(s))) { stats.skipped++; return; }

  try {
    let src = await readFile(fullPath, 'utf8');
    let modified = false;

    // ── إضافة logExecution import إن غاب ───────────────────
    if (!src.includes('executor') && !src.includes('logExecution')) {
      const importLine = `import { logExecution, safeStep, tableExists } from '../utils/executor.js';\n`;
      // حساب المسار النسبي الصحيح
      const depth = rel.split('/').length - 1;
      const prefix = depth === 1 ? '../' : '../../';
      const fixedImport = importLine.replace('../utils/', `${prefix}utils/`);

      // أضف بعد آخر import
      const lastImport = src.lastIndexOf('\nimport ');
      if (lastImport !== -1) {
        const endOfLine = src.indexOf('\n', lastImport + 1);
        src = src.slice(0, endOfLine + 1) + fixedImport + src.slice(endOfLine + 1);
        modified = true;
      }
    }

    // ── إضافة try/catch لـgovernor.js فقط ──────────────────
    if (rel === 'governance/governor.js' && !src.includes('try {')) {
      // wrap الـexport functions
      src = src.replace(
        /^(export\s+(?:async\s+)?function\s+\w+[^{]*\{)/gm,
        '$1\n  try {'
      );
      modified = true;
    }

    if (modified) {
      await writeFile(fullPath, src, 'utf8');
      stats.patched++;
      console.log(`✅ patched: ${rel}`);
    } else {
      stats.skipped++;
    }
  } catch(e) {
    stats.errors++;
    console.error(`❌ ${rel}: ${e.message}`);
  }
}

const all = await scanAll(BASE);
for (const f of all) {
  await patchFile(f);
}

console.log(`\n📊 Done — patched:${stats.patched} skipped:${stats.skipped} errors:${stats.errors}`);
