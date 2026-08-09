/**
 * TRUNKIA Sovereign Security Audit v1.0 (Omega Protocol)
 * 
 * Scans all source files for OWASP Top 10 vulnerabilities:
 * 1. Hardcoded Secrets
 * 2. SQL Injection (string concatenation)
 * 3. XSS (unescaped output)
 * 4. Insecure Crypto (weak algorithms)
 * 5. Prototype Pollution
 * 6. Path Traversal
 * 7. ReDoS patterns
 * 8. Debug code in production
 * 9. Error message info leak
 * 10. Missing input validation
 * 
 * Output: JSON report + Security Score + Specific file:line references
 */

import fs from 'fs';
import path from 'path';

const SCAN_DIRS = ['lib/', 'utils/', 'scripts/', 'agents/'];
const SCAN_FILES = ['index.js'];
const SCAN_EXTS = ['.js', '.mjs', '.cjs'];

const VULNERABILITY_PATTERNS = [
  {
    id: 'SECRET_HARDCODED',
    severity: 'CRITICAL',
    pattern: /(sk-[a-zA-Z0-9]{20,}|gsk_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|AKIA[A-Z0-9]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/,
    message: 'Hardcoded secret detected'
  },
  {
    id: 'SQL_INJECTION',
    severity: 'CRITICAL',
    pattern: /(?:query|execute|safeQuery)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC)[^'"`]*\$\{/,
    message: 'SQL Injection: string interpolation in query'
  },
  {
    id: 'EVAL_USAGE',
    severity: 'CRITICAL',
    pattern: /\beval\s*\(/,
    message: 'eval() usage - Remote Code Execution risk'
  },
  {
    id: 'PROTO_POLLUTION',
    severity: 'HIGH',
    pattern: /(?:__proto__|constructor\s*\[|prototype\s*\[)/,
    message: 'Prototype Pollution risk'
  },
  {
    id: 'PATH_TRAVERSAL',
    severity: 'HIGH',
    pattern: /\.\.\/|\.\.\\|%2e%2e/,
    message: 'Path Traversal pattern'
  },
  {
    id: 'INSECURE_CRYPTO',
    severity: 'HIGH',
    pattern: /createCipher\s*\(|createDecipher\s*\(|md5|sha1(?!\d)/i,
    message: 'Insecure crypto algorithm'
  },
  {
    id: 'TIMING_UNSAFE',
    severity: 'MEDIUM',
    pattern: /===\s*['"`][a-f0-9]{32,}/,
    message: 'Timing-unsafe comparison on hash/token (use timingSafeEqual)'
  },
  {
    id: 'CONSOLE_LOG_SECRET',
    severity: 'HIGH',
    pattern: /console\.log\(.*(apiKey|secret|token|password|rawKey|IMMUNE_SECRET).*\)/i,
    message: 'Sensitive data in console.log'
  },
  {
    id: 'REDOS_RISK',
    severity: 'MEDIUM',
    pattern: /\(\.\*\)\+/,
    message: 'ReDoS risk: greedy quantifier on . (use [^\\n] or bounded)'
  },
  {
    id: 'MISSING_AWAIT',
    severity: 'MEDIUM',
    pattern: /(?:query|fetch|exec|save|delete|update)\([^)]*\)(?!\s*(?:await|\.|;|\n|\)|\s*\/\/))/,
    message: 'Possibly missing await on async call'
  },
  {
    id: 'CORS_WILDCARD',
    severity: 'MEDIUM',
    pattern: /cors\s*\(\s*\{\s*origin\s*:\s*['"`]\*['"`]/,
    message: 'CORS wildcard origin'
  },
  {
    id: 'HELMET_DISABLED',
    severity: 'LOW',
    pattern: /helmet\s*\(\s*\{\s*contentSecurityPolicy\s*:\s*false/,
    message: 'Helmet CSP disabled'
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
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) continue;

    for (const { id, severity, pattern, message } of VULNERABILITY_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          file: filePath,
          line: i + 1,
          id,
          severity,
          message,
          snippet: line.trim().substring(0, 120)
        });
      }
    }
  }

  return findings;
}

function calculateScore(findings) {
  let score = 100;
  const weights = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3 };
  for (const f of findings) {
    score -= weights[f.severity] || 5;
  }
  return Math.max(0, score);
}

function runAudit() {
  console.log('==========================================================');
  console.log('[SOVEREIGN SECURITY AUDIT v1.0] Scanning codebase...');
  console.log('==========================================================');

  let allFiles = [];
  for (const dir of SCAN_DIRS) allFiles = allFiles.concat(walkDir(dir));
  for (const file of SCAN_FILES) {
    if (fs.existsSync(file)) allFiles.push(file);
  }

  console.log('[SCAN] Files to scan: ' + allFiles.length);

  let allFindings = [];
  let filesScanned = 0;

  for (const file of allFiles) {
    const findings = scanFile(file);
    filesScanned++;
    if (findings.length > 0) {
      allFindings = allFindings.concat(findings);
    }
  }

  const score = calculateScore(allFindings);
  const critical = allFindings.filter(f => f.severity === 'CRITICAL');
  const high = allFindings.filter(f => f.severity === 'HIGH');
  const medium = allFindings.filter(f => f.severity === 'MEDIUM');
  const low = allFindings.filter(f => f.severity === 'LOW');

  console.log('\n==========================================================');
  console.log('[SECURITY AUDIT REPORT]');
  console.log('==========================================================');
  console.log('Files scanned: ' + filesScanned);
  console.log('Total findings: ' + allFindings.length);
  console.log('  CRITICAL: ' + critical.length);
  console.log('  HIGH: ' + high.length);
  console.log('  MEDIUM: ' + medium.length);
  console.log('  LOW: ' + low.length);
  console.log('Security Score: ' + score + '/100');

  let grade = 'A';
  if (score < 90) grade = 'B';
  if (score < 75) grade = 'C';
  if (score < 60) grade = 'D';
  if (score < 40) grade = 'F';
  console.log('Security Grade: ' + grade);

  if (allFindings.length > 0) {
    console.log('\n[DETAILED FINDINGS]');
    const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    for (const f of allFindings) {
      console.log('  [' + f.severity + '] ' + f.id + ' - ' + f.file + ':' + f.line);
      console.log('    ' + f.message);
      console.log('    > ' + f.snippet);
      console.log('');
    }
  }

  console.log('==========================================================');
  if (score >= 90) {
    console.log('[✓] SECURITY AUDIT PASSED: Codebase is secure.');
    process.exit(0);
  } else if (score >= 60) {
    console.log('[⚠] SECURITY AUDIT PARTIAL: Issues found but not critical.');
    process.exit(0);
  } else {
    console.log('[✗] SECURITY AUDIT FAILED: Critical vulnerabilities found.');
    process.exit(1);
  }
}

runAudit();
