/**
 * TRUNKIA Sovereign Security Audit v3.0 (Omega Protocol)
 * Recognizes safeIdentifier() as safe pattern.
 */
import fs from 'fs';
import path from 'path';

const SCAN_DIRS = ['lib/', 'utils/', 'scripts/', 'agents/'];
const SCAN_FILES = ['index.js'];
const SCAN_EXTS = ['.js', '.mjs', '.cjs'];

const VULNERABILITY_PATTERNS = [
  {
    id: 'SQL_INJECTION',
    severity: 'CRITICAL',
    pattern: /(?:query|execute|safeQuery)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC)[^'"`]*\$\{(?!safeIdentifier)/,
    message: 'SQL Injection: unsafe string interpolation in query (use safeIdentifier)'
  },
  {
    id: 'EVAL_USAGE',
    severity: 'CRITICAL',
    pattern: /(?<![\w.])eval\s*\(/,
    message: 'eval() usage - Remote Code Execution risk'
  },
  {
    id: 'PROTO_POLLUTION',
    severity: 'HIGH',
    pattern: /(?<![\w./])__proto__(?![\w/])|(?<![\w./])constructor\s*\[/,
    message: 'Prototype Pollution risk'
  },
  {
    id: 'INSECURE_CRYPTO',
    severity: 'HIGH',
    pattern: /createCipher\s*\(|createDecipher\s*\(|\bmd5\b|\bsha1\b(?!\d)/,
    message: 'Insecure crypto algorithm'
  },
  {
    id: 'CONSOLE_LOG_SECRET',
    severity: 'HIGH',
    pattern: /console\.log\(.*(apiKey|secret|token|password|rawKey|IMMUNE_SECRET).*\)/i,
    message: 'Sensitive data in console.log'
  }
];

function walkDir(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) results = results.concat(walkDir(filePath));
    else if (SCAN_EXTS.includes(path.extname(file))) results.push(filePath);
  }
  return results;
}

function scanFile(filePath) {
  if (filePath.includes('sovereign-security-audit.mjs')) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (trimmed.startsWith('import ') || trimmed.includes('require(') || trimmed.includes('from ')) continue;
    for (const { id, severity, pattern, message } of VULNERABILITY_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ file: filePath, line: i + 1, id, severity, message, snippet: line.trim().substring(0, 150) });
      }
    }
  }
  return findings;
}

function calculateScore(findings) {
  let score = 100;
  const weights = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3 };
  for (const f of findings) score -= weights[f.severity] || 5;
  return Math.max(0, score);
}

function runAudit() {
  console.log('==========================================================');
  console.log('[SOVEREIGN SECURITY AUDIT v3.0] Scanning codebase...');
  console.log('==========================================================');
  let allFiles = [];
  for (const dir of SCAN_DIRS) allFiles = allFiles.concat(walkDir(dir));
  for (const file of SCAN_FILES) if (fs.existsSync(file)) allFiles.push(file);
  let allFindings = [];
  for (const file of allFiles) allFindings = allFindings.concat(scanFile(file));
  const score = calculateScore(allFindings);
  const critical = allFindings.filter(f => f.severity === 'CRITICAL');
  const high = allFindings.filter(f => f.severity === 'HIGH');
  console.log('Files scanned: ' + allFiles.length);
  console.log('Total findings: ' + allFindings.length);
  console.log('  CRITICAL: ' + critical.length);
  console.log('  HIGH: ' + high.length);
  console.log('Security Score: ' + score + '/100');
  console.log('Security Grade: ' + (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F'));
  if (allFindings.length > 0) {
    console.log('\n[DETAILED FINDINGS]');
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    for (const f of allFindings) {
      console.log(`  [${f.severity}] ${f.id} - ${f.file}:${f.line}`);
      console.log(`    ${f.message}`);
      console.log(`    > ${f.snippet}\n`);
    }
  }
  console.log('==========================================================');
  if (score >= 90) { console.log('[✓] SECURITY AUDIT PASSED.'); process.exit(0); }
  else if (score >= 60) { console.log('[⚠] SECURITY AUDIT PARTIAL.'); process.exit(0); }
  else { console.log('[✗] SECURITY AUDIT FAILED.'); process.exit(1); }
}

runAudit();
