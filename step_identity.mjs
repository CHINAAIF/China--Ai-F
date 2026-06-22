import { promises as fs } from 'fs';
import { execSync } from 'child_process';

console.log('=== TRUNKIA Identity Sanitization ===\n');

// 1. package.json
try {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  pkg.name = 'trunkia-core';
  pkg.description = 'TRUNKIA — Global AI Model Navigator. Transparency. Comparison. Mastery.';
  pkg.version = pkg.version || '1.0.0';
  await fs.writeFile('package.json', JSON.stringify(pkg, null, 2));
  console.log('✅ package.json → trunkia-core');
} catch(e) {
  console.log('❌ package.json:', e.message);
}

// 2. Root route في index.js
try {
  let idx = await fs.readFile('index.js', 'utf8');
  
  // استبدل الـroot route الموجود
  const oldRoot = /app\.get\('\/'\s*,\s*\(req,\s*res\)\s*=>\s*res\.json\(\{[^}]+\}\)\s*\)\s*;/;
  const newRoot = `app.get('/', (req, res) => res.json({
  platform: 'TRUNKIA',
  tagline: 'Global AI Model Navigator',
  version: '1.0.0',
  status: 'operational',
  mission: 'Transparency. Comparison. Mastery.',
  disclaimer: 'Independent platform. Not affiliated with any government or AI company.',
  docs: '/api/docs',
  health: '/health'
}));`;

  if (oldRoot.test(idx)) {
    idx = idx.replace(oldRoot, newRoot);
    console.log('✅ root route: updated');
  } else {
    // أضف root route في البداية بعد middleware
    idx = idx.replace(
      `app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));`,
      `app.get('/', (req, res) => res.json({
  platform: 'TRUNKIA',
  tagline: 'Global AI Model Navigator',
  version: '1.0.0',
  status: 'operational',
  mission: 'Transparency. Comparison. Mastery.',
  disclaimer: 'Independent platform. Not affiliated with any government or AI company.',
  docs: '/api/docs',
  health: '/health'
}));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));`
    );
    console.log('✅ root route: injected');
  }

  // 3. استبدل BOOT_MARKER برسالة TRUNKIA
  idx = idx.replace(
    `console.log("🚀 BOOT_MARKER: TRUNKIA starting...");`,
    `console.log("🚀 TRUNKIA Core starting...");`
  );

  // 4. استبدل Sovereign Kernel برسالة TRUNKIA
  idx = idx.replace(
    /Sovereign Kernel Active/g,
    'TRUNKIA Core Active'
  );

  await fs.writeFile('index.js', idx);
  console.log('✅ index.js → TRUNKIA branding');
} catch(e) {
  console.log('❌ index.js:', e.message);
}

// 5. تحقق syntax
try {
  execSync('node --check index.js', { stdio: 'pipe' });
  console.log('✅ syntax OK');
} catch(e) {
  console.log('❌ syntax error:', e.stderr?.toString().split('\n')[1]);
  process.exit(1);
}

// 6. README
try {
  const readme = `# TRUNKIA
## Global AI Model Navigator

> Transparency. Comparison. Mastery.

TRUNKIA is an independent AI model intelligence platform.
We help you discover, compare, and master AI models from around the world.

### What We Offer
- **Model Comparison**: Side-by-side comparison of global AI models
- **Pricing Intelligence**: Real-time pricing and cost analysis
- **Performance Benchmarks**: Objective performance data
- **Learning Resources**: Guides, prompts, and tutorials
- **Open Source Directory**: Curated list of open-source models

### Disclaimer
Independent platform. Not affiliated with any government or AI company.
All data sourced from publicly available information.

### API
Base URL: https://web-production-d41fb.up.railway.app
- GET / — Platform info
- GET /health — System health
- GET /api/sovereign/status — System status
`;
  await fs.writeFile('README.md', readme);
  console.log('✅ README.md → TRUNKIA');
} catch(e) {
  console.log('❌ README:', e.message);
}

// 7. commit + push
try {
  execSync('git add -A', { stdio: 'inherit' });
  execSync('git commit -m "rebrand: complete — TRUNKIA Sovereign AI Governance"', { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });
  console.log('\n✅ push تم');
} catch(e) {
  console.log('❌ git:', e.message);
}

console.log('\n=== التحقق النهائي ===');
console.log('انتظر 30 ثانية ثم نفذ:');
console.log('curl -s https://web-production-d41fb.up.railway.app/');
