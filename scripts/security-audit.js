import '../config/env.js';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { execSync } from 'child_process';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Files/Dirs to ignore to prevent false positives (auditor scanning itself)
const IGNORE_DIRS = ['./scripts/sanitize-codebase.js', './scripts/security-audit.js'];

async function scanCode() {
  console.log('\n=== [1/3] Static Code Analysis (SAST) ===');
  let vulnCount = 0;
  const directories = ['./agents', './lib', './scripts', './config'];

  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (IGNORE_DIRS.some(p => fullPath.endsWith(path.basename(p)))) continue;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) walkDir(fullPath);
      else if (file.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, i) => {
          if (line.match(/process\.env\.\w+\s*\|\|/)) {
// [AUDIT REDACTED]             console.log(`[CRITICAL] Default secret fallback in ${fullPath}:${i+1}`);
            vulnCount++;
          }
          if (line.includes('rejectUnauthorized: false')) {
            console.log(`[HIGH] SSL Verification disabled in ${fullPath}:${i+1}`);
            vulnCount++;
          }
          if (line.includes('dotenv.config()') && !fullPath.includes('config/env.js')) {
            console.log(`[MEDIUM] Bypassed central env management in ${fullPath}:${i+1}`);
            vulnCount++;
          }
        });
      }
    }
  }

  directories.forEach(walkDir);
  if (vulnCount === 0) console.log('[PASS] No dangerous code patterns found.');
}

async function scanDatabase() {
  console.log('\n=== [2/3] Database Security Posture ===');
  
  const rlsTables = ['users', 'api_keys', 'sessions', 'byok_keys'];
  for (const table of rlsTables) {
    const res = await pool.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1", [table]);
    if (res.rows.length > 0 && (!res.rows[0].relrowsecurity || !res.rows[0].relforcerowsecurity)) {
      console.log(`[HIGH] RLS is NOT properly enforced on table: ${table}`);
    } else {
      console.log(`[PASS] RLS active and forced on ${table}`);
    }
  }

  // Whitelist Neon internal roles to avoid False Positives
  const bypassRoles = await pool.query("SELECT rolname FROM pg_roles WHERE rolbypassrls = true AND rolname NOT IN ('neondb_owner', 'postgres', 'cloud_admin', 'neon_service', 'neon_superuser')");
  if (bypassRoles.rows.length > 0) {
    console.log('[CRITICAL] Rogue application roles with BYPASSRLS detected:', bypassRoles.rows.map(r => r.rolname).join(', '));
  } else {
    console.log('[PASS] No rogue BYPASSRLS application roles.');
  }

  const canaryTriggers = await pool.query("SELECT COUNT(*) as count FROM information_schema.triggers WHERE event_object_table LIKE 'canary%'");
  if (parseInt(canaryTriggers.rows[0].count) === 0) {
    console.log('[WARNING] Canary tables are passive (No real-time triggers).');
  } else {
    console.log('[PASS] Canary tables have active triggers.');
  }
}

async function scanDependencies() {
  console.log('\n=== [3/3] Dependency Audit (NPM) ===');
  try {
    const output = execSync('npm audit --audit-level=high --json', { encoding: 'utf8' });
    const audit = JSON.parse(output);
    if (audit.metadata.vulnerabilities.high > 0 || audit.metadata.vulnerabilities.critical > 0) {
      console.log(`[CRITICAL] Found ${audit.metadata.vulnerabilities.high} high and ${audit.metadata.vulnerabilities.critical} critical vulnerabilities.`);
    } else {
      console.log('[PASS] No high or critical vulnerabilities in dependencies.');
    }
  } catch (err) {
    // npm audit exits with code 1 if vulns are found, so we expect an error
    if (err.stdout) {
      const audit = JSON.parse(err.stdout);
      if (audit.metadata.vulnerabilities.high > 0 || audit.metadata.vulnerabilities.critical > 0) {
        console.log(`[CRITICAL] Found ${audit.metadata.vulnerabilities.high} high and ${audit.metadata.vulnerabilities.critical} critical vulnerabilities.`);
      } else {
        console.log('[PASS] No high or critical vulnerabilities in dependencies.');
      }
    } else {
      console.log('[ERROR] Could not run npm audit.');
    }
  }
}

async function run() {
  console.log('🛡️ TRUNKIA META-SCANNER v2.0 🛡️');
  try {
    await scanCode();
    await scanDatabase();
    await scanDependencies();
    console.log('\n=== Audit Complete ===');
  } catch (e) {
    console.error('[FATAL] Audit failed:', e.message);
  } finally {
    await pool.end();
  }
}

run();
