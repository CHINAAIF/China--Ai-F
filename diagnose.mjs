import { readdir, readFile } from 'fs/promises';
import path from 'path';

const BASE = '/data/data/com.termux/files/home/downloads/China--Ai-F/agents';

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

const SKIP = ['utils/', 'registry.js', 'brain.js', 'index.js', 'worker-scheduler.js'];
const errors = [];
const all = await scanAll(BASE);

for (const f of all) {
  const rel = f.replace(BASE+'/', '');
  if (SKIP.some(s => rel.includes(s))) continue;
  try {
    const src = await readFile(f, 'utf8');
    const issues = [];

    // run() بأي صيغة
    const hasRun = src.includes('async run(') || 
                   src.includes('export async function run') ||
                   src.includes('run = async') ||
                   src.includes('run(input');
    if (!hasRun) issues.push('NO_RUN_METHOD');

    if (!src.includes('export default')) issues.push('NO_DEFAULT_EXPORT');
    if (!src.includes('try {'))          issues.push('NO_TRY_CATCH');

    if (issues.length > 0) errors.push({ file: rel, issues });
  } catch(e) {
    errors.push({ file: rel, issues: ['READ_ERROR: ' + e.message] });
  }
}

console.log('=== DIAGNOSIS ===');
console.log('Total scanned:', all.length);
console.log('Files with issues:', errors.length);
errors.forEach(e => console.log(`❌ ${e.file} — ${e.issues.join(', ')}`));
if (errors.length === 0) console.log('✅ All agents healthy');
process.exit(0);
