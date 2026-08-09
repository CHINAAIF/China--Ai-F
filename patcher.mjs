import fs from 'fs';

let code = fs.readFileSync('index.js', 'utf8');
const newRoute = fs.readFileSync('.new-route.txt', 'utf8').trim();

// 1. Add sovereignCommandCenter import if missing
if (!code.includes('sovereign-command-center')) {
  const imports = code.match(/^(import .*?;)$/gm);
  if (imports && imports.length > 0) {
    const lastImport = imports[imports.length - 1];
    code = code.replace(lastImport, lastImport + "\nimport { sovereignCommandCenter } from './lib/services/sovereign-command-center.js';");
    console.log('[PATCH] + sovereignCommandCenter import');
  }
}

// 2. Remove old setup/shutdown blocks (clean slate)
const removePatterns = [
  /\/\* ===== GRACEFUL SHUTDOWN[\s\S]*?process\.on\("SIGINT"[\s\S]*?\}\);\n*/g,
  /\/\* ===== RATE LIMITER POOL SETUP[\s\S]*?\}\n*/g,
  /\/\* ===== UNIVERSAL SETUP[\s\S]*?process\.on\("SIGINT"[\s\S]*?\}\);\n*/g,
  /\/\* ===== SOVEREIGN SETUP[\s\S]*?process\.on\("SIGINT"[\s\S]*?\}\);\n*/g,
  /let isShuttingDown = false;[\s\S]*?process\.on\("SIGINT"[\s\S]*?\}\);\n*/g,
  /process\.on\('SIGTERM'[\s\S]*?\}\);\n*/g,
  /process\.on\('SIGINT'[\s\S]*?\}\);\n*/g
];
for (const pattern of removePatterns) {
  code = code.replace(pattern, '');
}

// 3. Remove old /v1/chat/completions route (brace matching)
const routeStart = code.indexOf('app.post("/v1/chat/completions"');
if (routeStart !== -1) {
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let routeEnd = -1;
  for (let i = routeStart; i < code.length; i++) {
    const ch = code[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; continue; }
    if (ch === '{') braceCount++;
    if (ch === '}') {
      braceCount--;
      if (braceCount === 0) {
        let j = i + 1;
        while (j < code.length && code[j] !== ';') j++;
        routeEnd = j + 1;
        break;
      }
    }
  }
  if (routeEnd !== -1) {
    code = code.substring(0, routeStart) + newRoute + code.substring(routeEnd);
    console.log('[PATCH] + /v1/chat/completions replaced');
  }
}

// 4. Add Command Center endpoints before 404 handler
if (!code.includes('/api/sovereign/command-center')) {
  const handler404 = code.match(/app\.use\(function\s*\(\s*req\s*,\s*res\s*,\s*next\s*\)\s*\{/);
  if (handler404) {
    const insertPos = code.indexOf(handler404[0]);
    const endpoints = "app.get('/api/sovereign/command-center', (req, res) => { res.json(sovereignCommandCenter.getFullReport()); });\napp.get('/api/sovereign/audit/verify', (req, res) => { res.json(sovereignCommandCenter.verifyChainIntegrity()); });\n\n";
    code = code.substring(0, insertPos) + endpoints + code.substring(insertPos);
    console.log('[PATCH] + Command Center endpoints');
  }
}

// 5. Add Pool setup + Graceful shutdown before app.listen
if (!code.includes('SOVEREIGN SHUTDOWN')) {
  const listenMatch = code.match(/app\.listen\(PORT/);
  if (listenMatch) {
    const listenPos = code.indexOf(listenMatch[0]);
    const setupCode = [
      '/* ===== SOVEREIGN SHUTDOWN ===== */',
      'let isShuttingDown = false;',
      'async function handleShutdown(signal) {',
      '  if (isShuttingDown) return;',
      '  isShuttingDown = true;',
      '  console.log("[SHUTDOWN] " + signal + " received.");',
      '  try { await gracefulCronShutdown(10000); } catch(e) {}',
      '  try { destroyRateLimiter(); } catch(e) {}',
      '  process.exit(0);',
      '}',
      "process.on('SIGTERM', () => handleShutdown('SIGTERM'));",
      "process.on('SIGINT', () => handleShutdown('SIGINT'));",
      '',
      ''
    ].join('\n');
    code = code.substring(0, listenPos) + setupCode + code.substring(listenPos);
    console.log('[PATCH] + Graceful shutdown');
  }
}

fs.writeFileSync('index.js', code);
console.log('[PATCH] Done.');
