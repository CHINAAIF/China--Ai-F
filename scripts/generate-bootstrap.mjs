/**
 * TRUNKIA Sovereign Bootstrap Generator v2.0 (Omega Protocol)
 * 
 * Enterprise Features:
 * 1. Hierarchical Classification (TABLE → INDEX → FUNCTION → TRIGGER → POLICY → GRANT)
 * 2. Smart Conflict Resolution (IF NOT EXISTS injection)
 * 3. Dollar Quote Validation
 * 4. Transaction Wrapping per layer
 * 5. Post-Generation Verification Report
 * 6. Sovereign Additions (user_quota, quota_audit, audit trail)
 */

import fs from 'fs';
import path from 'path';

// === SCHEMA FILES IN DEPENDENCY ORDER ===
const SCHEMA_FILES = [
  'schema-part1.sql',
  'schema-part2.sql',
  'schema-part3.sql',
  'schema-part4.sql',
  'schema-part5.sql',
  'schema-v5-p5a.sql',
  'schema-v5-p5b.sql',
  'schema-v5-p5c.sql',
  'agents/schema.sql',
  'migrations/fix_canary_tokens_protection.sql',
  'migrations/apply_strict_rls.sql',
  'install-triggers.sql'
];

// === SOVEREIGN ADDITIONS ===
const SOVEREIGN_ADDITIONS = `
-- === SOVEREIGN ADDITIONS (Omega Protocol) ===

-- Schema Version Tracking
CREATE TABLE IF NOT EXISTS sovereign_schema_versions (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL UNIQUE,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  hmac_signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User Quota (Atomic Financial Fairness)
CREATE TABLE IF NOT EXISTS user_quota (
  user_id TEXT PRIMARY KEY,
  remaining_quota BIGINT DEFAULT 1000000,
  held_quota BIGINT DEFAULT 0,
  total_consumed BIGINT DEFAULT 0
);

-- Quota Audit Trail
CREATE TABLE IF NOT EXISTS quota_audit (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT UNIQUE,
  held_amount BIGINT NOT NULL,
  actual_cost BIGINT NOT NULL,
  refund BIGINT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grant permissions to app_user (if exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Role grant skipped: %', SQLERRM;
END $$;
`;

// === SQL STATEMENT SPLITTER ===
function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false, inDouble = false, inDollar = false, dollarTag = '';
  let inLine = false, inBlock = false;
  
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    
    // Line comments
    if (!inSingle && !inDouble && !inDollar && !inBlock && char === '-' && next === '-') {
      inLine = true;
    }
    if (inLine) {
      current += char;
      if (char === '\n') inLine = false;
      continue;
    }
    
    // Block comments
    if (!inSingle && !inDouble && !inDollar && !inLine && char === '/' && next === '*') {
      inBlock = true;
      current += char + next;
      i++;
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        current += char + next;
        i++;
        inBlock = false;
        continue;
      }
      current += char;
      continue;
    }
    
    // Single quotes
    if (char === "'" && !inDouble && !inDollar) inSingle = !inSingle;
    
    // Double quotes
    if (char === '"' && !inSingle && !inDollar) inDouble = !inDouble;
    
    // Dollar quotes
    if (char === '$' && !inSingle && !inDouble && !inBlock && !inLine) {
      if (!inDollar) {
        const match = sql.substring(i).match(/^\$[a-zA-Z_0-9]*\$/);
        if (match) {
          dollarTag = match[0];
          inDollar = true;
          current += match[0];
          i += match[0].length - 1;
          continue;
        }
      } else {
        if (sql.substring(i).startsWith(dollarTag)) {
          current += dollarTag;
          i += dollarTag.length - 1;
          inDollar = false;
          dollarTag = '';
          continue;
        }
      }
    }
    
    // Semicolons
    if (char === ';' && !inSingle && !inDouble && !inDollar && !inLine && !inBlock) {
      current += char;
      const trimmed = current.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('--')) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }
    
    current += char;
  }
  
  const trimmed = current.trim();
  if (trimmed.length > 0 && !trimmed.startsWith('--')) {
    statements.push(trimmed);
  }
  
  return statements;
}

// === DOLLAR QUOTE VALIDATOR ===
function validateDollarQuotes(stmt) {
  const matches = stmt.match(/\$[a-zA-Z_0-9]*\$/g);
  if (!matches) return true;
  return matches.length % 2 === 0;
}

// === HIERARCHICAL CLASSIFIER ===
function classifyStatement(stmt) {
  const upper = stmt.toUpperCase().trim();
  
  if (upper.startsWith('CREATE TABLE') || upper.startsWith('ALTER TABLE')) return 'TABLE';
  if (upper.startsWith('CREATE INDEX') || upper.startsWith('CREATE UNIQUE INDEX')) return 'INDEX';
  if (upper.startsWith('CREATE FUNCTION') || upper.startsWith('CREATE OR REPLACE FUNCTION') || upper.startsWith('CREATE PROCEDURE')) return 'FUNCTION';
  if (upper.startsWith('CREATE TRIGGER') || upper.startsWith('CREATE OR REPLACE TRIGGER')) return 'TRIGGER';
  if (upper.startsWith('CREATE POLICY') || upper.startsWith('DROP POLICY')) return 'POLICY';
  if (upper.startsWith('GRANT') || upper.startsWith('REVOKE')) return 'GRANT';
  if (upper.startsWith('CREATE ROLE') || upper.startsWith('CREATE USER') || upper.startsWith('DO $$')) return 'ROLE';
  if (upper.startsWith('CREATE SCHEMA') || upper.startsWith('CREATE EXTENSION')) return 'SCHEMA';
  if (upper.startsWith('CREATE TYPE') || upper.startsWith('CREATE VIEW') || upper.startsWith('CREATE MATERIALIZED VIEW')) return 'TYPE';
  if (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE')) return 'DATA';
  
  return 'OTHER';
}

// === CONFLICT RESOLVER ===
function resolveConflicts(stmt) {
  // Convert CREATE TABLE to CREATE TABLE IF NOT EXISTS
  if (/^CREATE\s+TABLE\s+(?!.*IF\s+NOT\s+EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  }
  
  // Convert CREATE INDEX to CREATE INDEX IF NOT EXISTS
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!.*IF\s+NOT\s+EXISTS)/i.test(stmt)) {
    return stmt.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i, 'CREATE $1INDEX IF NOT EXISTS ');
  }
  
  // Convert CREATE TYPE to CREATE TYPE IF NOT EXISTS (via DO block)
  if (/^CREATE\s+TYPE\s+/i.test(stmt) && !/IF\s+NOT\s+EXISTS/i.test(stmt)) {
    const match = stmt.match(/^CREATE\s+TYPE\s+(\w+)\s+AS\s+(.+);$/is);
    if (match) {
      return `DO $$ BEGIN CREATE TYPE ${match[1]} AS ${match[2]}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
    }
  }
  
  return stmt;
}

// === MAIN GENERATOR ===
function generateBootstrap() {
  console.log('==========================================================');
  console.log('[BOOTSTRAP GENERATOR v2.0] Initializing...');
  console.log('==========================================================');
  
  // Collect all statements
  const allStatements = [];
  const stats = {
    files: { read: 0, skipped: 0 },
    statements: { total: 0, valid: 0, invalid: 0 },
    categories: { TABLE: 0, INDEX: 0, FUNCTION: 0, TRIGGER: 0, POLICY: 0, GRANT: 0, ROLE: 0, SCHEMA: 0, TYPE: 0, DATA: 0, OTHER: 0 }
  };
  
  // Read schema files
  for (const file of SCHEMA_FILES) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.log(`[SKIP] ${file} not found.`);
      stats.files.skipped++;
      continue;
    }
    
    const sql = fs.readFileSync(filePath, 'utf8');
    const statements = splitSQLStatements(sql);
    console.log(`[READ] ${file}: ${statements.length} statements`);
    stats.files.read++;
    
    for (const stmt of statements) {
      if (stmt.length < 5) continue;
      
      // Validate dollar quotes
      if (!validateDollarQuotes(stmt)) {
        console.warn(`  [WARN] Unbalanced dollar quotes in statement: ${stmt.substring(0, 60)}...`);
        stats.statements.invalid++;
        continue;
      }
      
      const category = classifyStatement(stmt);
      const resolved = resolveConflicts(stmt);
      
      allStatements.push({ category, statement: resolved, source: file });
      stats.statements.valid++;
      stats.categories[category]++;
    }
  }
  
  // Add sovereign additions
  const sovereignStmts = splitSQLStatements(SOVEREIGN_ADDITIONS);
  for (const stmt of sovereignStmts) {
    if (stmt.length < 5) continue;
    const category = classifyStatement(stmt);
    const resolved = resolveConflicts(stmt);
    allStatements.push({ category, statement: resolved, source: 'SOVEREIGN_ADDITIONS' });
    stats.statements.valid++;
    stats.categories[category]++;
  }
  
  stats.statements.total = allStatements.length;
  
  // Sort by hierarchical order
  const hierarchy = ['SCHEMA', 'TYPE', 'TABLE', 'INDEX', 'FUNCTION', 'TRIGGER', 'POLICY', 'GRANT', 'ROLE', 'DATA', 'OTHER'];
  allStatements.sort((a, b) => hierarchy.indexOf(a.category) - hierarchy.indexOf(b.category));
  
  // Generate output
  let output = `-- ==========================================================\n`;
  output += `-- TRUNKIA SOVEREIGN BOOTSTRAP SCRIPT v2.0 (Omega Protocol)\n`;
  output += `-- Generated: ${new Date().toISOString()}\n`;
  output += `-- Run this in Neon SQL Editor as the Database Owner\n`;
  output += `-- Hierarchical Order: SCHEMA → TYPE → TABLE → INDEX → FUNCTION → TRIGGER → POLICY → GRANT\n`;
  output += `-- Total Statements: ${stats.statements.total}\n`;
  output += `-- ==========================================================\n\n`;
  
  // Group by category and wrap in transactions
  let currentCategory = '';
  for (const { category, statement, source } of allStatements) {
    if (category !== currentCategory) {
      if (currentCategory !== '') {
        output += `COMMIT;\n\n`;
      }
      output += `-- ==========================================================\n`;
      output += `-- LAYER: ${category}\n`;
      output += `-- ==========================================================\n`;
      output += `BEGIN;\n`;
      currentCategory = category;
    }
    
    // Add source comment
    output += `-- Source: ${source}\n`;
    output += statement + '\n\n';
  }
  
  if (currentCategory !== '') {
    output += `COMMIT;\n\n`;
  }
  
  // Verification section
  output += `-- ==========================================================\n`;
  output += `-- VERIFICATION QUERIES\n`;
  output += `-- ==========================================================\n`;
  output += `SELECT 'TABLES' as type, count(*) as count FROM pg_tables WHERE schemaname = 'public'\n`;
  output += `UNION ALL\n`;
  output += `SELECT 'TRIGGERS' as type, count(*) as count FROM information_schema.triggers WHERE trigger_schema = 'public'\n`;
  output += `UNION ALL\n`;
  output += `SELECT 'POLICIES' as type, count(*) as count FROM pg_policies WHERE schemaname = 'public'\n`;
  output += `UNION ALL\n`;
  output += `SELECT 'FUNCTIONS' as type, count(*) as count FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'\n`;
  output += `UNION ALL\n`;
  output += `SELECT 'INDEXES' as type, count(*) as count FROM pg_indexes WHERE schemaname = 'public';\n\n`;
  
  output += `-- ==========================================================\n`;
  output += `-- CRITICAL TABLE CHECK\n`;
  output += `-- ==========================================================\n`;
  const criticalTables = ['agent_registry', 'api_keys', 'app_user', 'event_log', 'governance_audit_chain', 'user_quota', 'sovereign_schema_versions'];
  for (const table of criticalTables) {
    output += `SELECT '${table}' as table_name, EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '${table}' AND schemaname = 'public') as exists;\n`;
  }
  
  output += `\n-- ==========================================================\n`;
  output += `-- BOOTSTRAP COMPLETE\n`;
  output += `-- ==========================================================\n`;
  
  // Write output
  fs.writeFileSync('sovereign-bootstrap.sql', output);
  
  // Print report
  console.log('\n==========================================================');
  console.log('[GENERATION REPORT]');
  console.log('==========================================================');
  console.log(`Files Read: ${stats.files.read}`);
  console.log(`Files Skipped: ${stats.files.skipped}`);
  console.log(`Total Statements: ${stats.statements.total}`);
  console.log(`Valid: ${stats.statements.valid} | Invalid: ${stats.statements.invalid}`);
  console.log(`Output Size: ${output.length} bytes (${(output.length / 1024).toFixed(1)} KB)`);
  
  console.log('\n[CATEGORY BREAKDOWN]');
  for (const [cat, count] of Object.entries(stats.categories)) {
    if (count > 0) console.log(`  ${cat}: ${count}`);
  }
  
  console.log('\n[CRITICAL TABLES IN OUTPUT]');
  for (const table of criticalTables) {
    const found = output.includes(`CREATE TABLE IF NOT EXISTS ${table}`);
    console.log(`  ${found ? '✓' : '✗'} ${table}`);
  }
  
  console.log('\n==========================================================');
  console.log('[✓] sovereign-bootstrap.sql generated successfully.');
  console.log('==========================================================');
  console.log('NEXT STEPS:');
  console.log('1. Copy file content: cat sovereign-bootstrap.sql');
  console.log('2. Go to Neon Dashboard > SQL Editor');
  console.log('3. Paste content and click Run');
  console.log('4. Check verification results at the bottom');
  console.log('==========================================================');
}

generateBootstrap();
