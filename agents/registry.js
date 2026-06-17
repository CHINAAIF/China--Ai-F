// مُولَّد تلقائيًا - مُحمِّل عام للوكلاء (singleton فقط - يستثني سكربتات standalone)
import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STANDALONE_SCRIPTS = [
  'intelligence/china-news-agent.js',
  'intelligence/pricing-tracker-agent.js',
  'governance/verification-agent.js'
];

async function walk(dir, out=[]) {
  for (const e of await fs.readdir(dir, {withFileTypes:true})) {
    if (['node_modules','.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.name.endsWith('.js') && !p.endsWith('registry.js')) out.push(p);
  }
  return out;
}

export async function loadAllAgents() {
  const all = await walk(__dirname);
  const files = all.filter(f => !STANDALONE_SCRIPTS.includes(path.relative(__dirname, f)));
  const loaded = []; const failed = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(f).href);
      const D = mod.default;
      let instance = typeof D === 'function' ? new D() : (D && typeof D === 'object' ? D : Object.values(mod)[0]);
      if (!instance) { failed.push({file:f, reason:'no usable export'}); continue; }
      loaded.push({ name: instance.name || path.basename(f,'.js'), layer: instance.layer || 'unknown', instance });
    } catch(e) { failed.push({file:f, reason:e.message}); }
  }
  return { loaded, failed, skipped: STANDALONE_SCRIPTS };
}
