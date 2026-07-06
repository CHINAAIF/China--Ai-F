import fs from 'fs';
import path from 'path';

const targetDirs = ['./agents', './lib', './scripts', './config'];
let stats = { filesScanned: 0, secretsFixed: 0, sslFixed: 0, dotenvRemoved: 0 };

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (file.endsWith('.js')) {
      sanitizeFile(fullPath);
    }
  }
}

function sanitizeFile(filePath) {
  stats.filesScanned++;
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // 1. Remove default secret fallbacks (e.g., process.env.KEY)
  // This regex matches process.env.ANYTHING)\s*\|\|[^;,\)]+/g, 'process.env.$1');
  
  // 2. Fix SSL Bypass (rejectUnauthorized: true -> true)
  content = content.replace(/rejectUnauthorized:\s*false/g, 'rejectUnauthorized: true');

  // 3. Remove direct dotenv.config() usage to enforce central env.js
  // Matches: import dotenv from 'dotenv'; (and variations) and if (!filePath.includes('config/env.js')) {
    content = content.replace(/import\s+dotenv\s+from\s+['"]dotenv['"];\s*\n/g, '');
    content = content.replace(/dotenv\.config\(\);\s*\n?/g, '');
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    // Calculate fixes applied for stats
    const oldSecrets = (originalContent.match(/process\.env\.\w+\s*\|\|/g) || []).length;
    const oldSsl = (originalContent.match(/rejectUnauthorized:\s*false/g) || []).length;
    const oldDotenv = (originalContent.match(/dotenv\.config\(\)/g) || []).length;
    stats.secretsFixed += oldSecrets;
    stats.sslFixed += oldSsl;
    stats.dotenvRemoved += oldDotenv;
  }
}

console.log('🧹 TRUNKIA AUTOMATED SANITIZER STARTED 🧹');
targetDirs.forEach(dir => walkDir(dir));

console.log(`[SUCCESS] Codebase Sanitization Complete.`);
console.log(`  Files Scanned: ${stats.filesScanned}`);
console.log(`  Default Secrets Removed: ${stats.secretsFixed}`);
console.log(`  SSL Vulnerabilities Fixed: ${stats.sslFixed}`);
console.log(`  Decentralized dotenv Calls Removed: ${stats.dotenvRemoved}`);
