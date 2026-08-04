import fs from 'fs';

// 1. Fix lib/inference.js
const infPath = 'lib/inference.js';
let inf = fs.readFileSync(infPath, 'utf8');
if (inf.includes("import { getPool, generateDbToken } from './lib/db.js';
const pool = getPool('main', generateDbToken('patch-remaining.mjs'));")) {
  inf = inf.replace("import { pool } from './db.js';", "import { getPool, generateDbToken } from './db.js';\nconst pool = getPool('main', generateDbToken('lib/inference.js'));");
  fs.writeFileSync(infPath, inf, 'utf8');
  console.log('✅ Patched lib/inference.js');
}

// 2. Rewrite trunkia_insider.js to test the new lock
const insiderPath = 'trunkia_insider.js';
const insiderContent = `import { getPool } from './lib/db.js';

console.log("--- Insider Threat Simulation ---");

async function attack() {
  console.log("Attempting to access 'governance' pool without token...");
  try {
    const p = getPool('governance');
    console.log("❌ FAIL: Insider acquired pool without token!");
  } catch (err) {
    console.log("✅ PASS: Insider blocked by Cryptographic Lock:", err.message);
  }
}
attack();
`;
fs.writeFileSync(insiderPath, insiderContent, 'utf8');
console.log('✅ Rewrote trunkia_insider.js for attack simulation');
