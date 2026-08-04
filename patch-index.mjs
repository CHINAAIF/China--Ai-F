import fs from 'fs';
const f = 'index.js';
let c = fs.readFileSync(f, 'utf8');

// 1. Fix the import
c = c.replace("import { getPool, generateDbToken } from './lib/db.js';
const pool = getPool('main', generateDbToken('patch-index.mjs'));;", "import { getPool as secureGetPool, generateDbToken } from './lib/db.js';");

// 2. Replace the vulnerable local getPool function
const oldFuncRegex = /function getPool\(\) \{\s*if \(!pool\) \{\s*var dbUrl = fixDbUrl\(process\.env\.DATABASE_URL\);\s*if \(!dbUrl\) throw new Error\('DATABASE_URL is not set'\);\s*pool = new pg\.Pool\(\{ connectionString: dbUrl, ssl: \{ rejectUnauthorized: true \} \}\);\s*pool\.on\('error', function\(err\) \{ console\.error\('\[POOL ERROR\]', err\.message\); circuitRecordFailure\(\); \}\);\s*\}\s*return pool;\s*\}/;
const newFunc = `function getPool() {\n  return secureGetPool('main', generateDbToken('index.js'));\n}`;

if (oldFuncRegex.test(c)) {
  c = c.replace(oldFuncRegex, newFunc);
  fs.writeFileSync(f, c, 'utf8');
  console.log('✅ SUCCESS: index.js patched. Legacy local pool destroyed. Secure Cryptographic Pool Lock enforced.');
} else {
  console.error('❌ FAIL: Could not find the vulnerable getPool function in index.js.');
}
