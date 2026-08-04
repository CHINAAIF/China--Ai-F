import fs from 'fs';

// 1. Fix safe-json.js (Remove broken res.choices overrides)
const safeJsonPath = 'lib/services/safe-json.js';
let safeJson = fs.readFileSync(safeJsonPath, 'utf8');

const brokenLineRegex = /var raw = res\.choices && res\.choices\[0\] && res\.choices\[0\]\.message && res\.choices\[0\]\.message\.content \? res\.choices\[0\]\.message\.content : '';\n/g;
if (brokenLineRegex.test(safeJson)) {
  safeJson = safeJson.replace(brokenLineRegex, '');
  fs.writeFileSync(safeJsonPath, safeJson, 'utf8');
  console.log('✅ Patched lib/services/safe-json.js (Removed broken res.choices overrides)');
} else {
  console.log('⚠️ safe-json.js broken lines not found or already patched.');
}

// 2. Fix lib/inference.js (Remove hardcoded risk_score: 0 to allow actual analysis)
const infPath = 'lib/inference.js';
let inf = fs.readFileSync(infPath, 'utf8');

if (inf.includes("return { sanitized: '', flags: [], risk_score: 0 };")) {
  inf = inf.replace("return { sanitized: '', flags: [], risk_score: 0 };", "return { sanitized: '', flags: [], risk_score: null };");
}
if (inf.includes("return { sanitized, flags, risk_score: 0 };")) {
  inf = inf.replace("return { sanitized, flags, risk_score: 0 };", "return { sanitized, flags, risk_score: null };");
  fs.writeFileSync(infPath, inf, 'utf8');
  console.log('✅ Patched lib/inference.js (Fixed hardcoded risk_score)');
} else {
  console.log('⚠️ inference.js hardcoded risk_score not found.');
}
