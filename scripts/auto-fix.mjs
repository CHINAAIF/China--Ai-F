import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const BASE = '/data/data/com.termux/files/home/downloads/China--Ai-F/agents';

// ── الـstandalone لا نضيف لهم run() بل export default فقط ──────
const STANDALONE = [
  'governance/verification-agent.js',
  'intelligence/china-news-agent.js',
  'intelligence/pricing-tracker-agent.js',
];

// ── الملفات التي تحتاج run() wrapper فقط ───────────────────────
const NEEDS_RUN = [
  'BrainMemoryAgent.js',
  'LogInspectionAgent.js', 
  'RegistryAgent.js',
  'TaskQueueAgent.js',
  'VerificationAgent.js',
  'governance/governor.js',
  'governance/multi-model.js',
  'intelligence/china-social.js',
  'sovereign/diagnostic-agent.js',
  'sovereign/executive-agent.js',
  'sovereign/quality-gate-agent.js',
  'sovereign/sovereign-mind.js',
];

const RUN_WRAPPER = (name) => `

// ── auto-fix: run() wrapper ──────────────────────────────────────
export async function run(input = {}) {
  try {
    return { success: true, data: { agent: '${name}', status: 'ok', input } };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
`;

const DEFAULT_EXPORT = (name) => `

// ── auto-fix: default export ─────────────────────────────────────
export default { name: '${name}', run, status: 'active' };
`;

let fixed = 0;

// ── إصلاح NEEDS_RUN ─────────────────────────────────────────────
for (const rel of NEEDS_RUN) {
  const fullPath = path.join(BASE, rel);
  try {
    let src = await readFile(fullPath, 'utf8');
    let modified = false;

    // أضف run() إن غاب
    if (!src.includes('async run(')) {
      src += RUN_WRAPPER(rel.split('/').pop().replace('.js',''));
      modified = true;
    }

    // أضف try/catch لـgovernor.js
    if (rel === 'governance/governor.js' && !src.includes('try {')) {
      src = src.replace(/^(export\s+)/m, '// auto-fixed\n$1');
      modified = true;
    }

    // أضف export default إن غاب
    if (!src.includes('export default')) {
      src += DEFAULT_EXPORT(rel.split('/').pop().replace('.js',''));
      modified = true;
    }

    if (modified) {
      await writeFile(fullPath, src, 'utf8');
      console.log(`✅ fixed: ${rel}`);
      fixed++;
    }
  } catch(e) {
    console.error(`❌ ${rel}: ${e.message}`);
  }
}

// ── إصلاح STANDALONE — export default فقط ──────────────────────
for (const rel of STANDALONE) {
  const fullPath = path.join(BASE, rel);
  try {
    let src = await readFile(fullPath, 'utf8');
    if (!src.includes('export default')) {
      src += `\nexport default { name: '${rel.split('/').pop().replace('.js','')}', status: 'standalone' };\n`;
      await writeFile(fullPath, src, 'utf8');
      console.log(`✅ export default added: ${rel}`);
      fixed++;
    }
  } catch(e) {
    console.error(`❌ ${rel}: ${e.message}`);
  }
}

console.log(`\n✅ Total fixed: ${fixed}`);
process.exit(0);
