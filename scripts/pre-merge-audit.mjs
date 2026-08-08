import fs from 'fs';
import path from 'path';

const TARGET_DIRS = ['lib/', 'utils/', 'scripts/'];
const TARGET_FILES = ['index.js'];
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/, /gsk_[a-zA-Z0-9]{20,}/, /ghp_[a-zA-Z0-9]{36,}/,
  /AKIA[A-Z0-9]{16}/, /-----BEGIN (RSA |EC )?PRIVATE KEY-----/
];
const LOG_PATTERNS = [
  /console\.log\(.*(apiKey|secret|token|password|rawKey|IMMUNE_SECRET).*\)/i
];

let vulnerabilitiesFound = 0;
let scannedFiles = 0;

function scanFile(filePath) {
  const ext = path.extname(filePath);
  if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') return;
  scannedFiles++;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[AUDIT FAIL] Potential secret in ${filePath}:${i+1}`);
        vulnerabilitiesFound++;
      }
    }
    for (const pattern of LOG_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[AUDIT FAIL] Sensitive data logging in ${filePath}:${i+1}`);
        vulnerabilitiesFound++;
      }
    }
  }
}

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      scanDirectory(fullPath);
    } else {
      scanFile(fullPath);
    }
  }
}

console.log('==========================================================');
console.log('[PRE-MERGE AUDIT] Scanning for security vulnerabilities...');
console.log('==========================================================');

TARGET_DIRS.forEach(scanDirectory);
TARGET_FILES.forEach(scanFile);
console.log(`[AUDIT] Scanned ${scannedFiles} files.`);

if (vulnerabilitiesFound > 0) {
  console.error(`[AUDIT] FATAL: ${vulnerabilitiesFound} vulnerabilities found. Merge Aborted.`);
  process.exit(1);
} else {
  console.log('[AUDIT] SUCCESS: Code is clean. Ready for production merge.');
  process.exit(0);
}
