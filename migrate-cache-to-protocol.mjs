import fs from 'fs';

// 1. Clean multi-model.js (Remove Cache logic)
const multiPath = 'agents/governance/multi-model.js';
let multi = fs.readFileSync(multiPath, 'utf8');

multi = multi.replace("import { semanticCache } from '../../lib/semantic-cache.js';\n", "");
multi = multi.replace(/const cached = semanticCache\.search\(prompt, userId\);\n    if \(cached\) \{\n      return cached;\n    \}\n/g, "");
multi = multi.replace(/\n        \/\/ 3\. تخزين النتيجة الناجحة في الـ Cache لطلب يستفيد منها مستقبلاً\n        semanticCache\.store\(prompt, result, userId, result\.tokens\);/g, "");
multi = multi.replace(/\n        \/\/ 6\. تخزين نتيجة التوافق الآمنة في الـ Cache\n        semanticCache\.store\(prompt, finalResult, userId, finalResult\.tokens\);/g, "");

fs.writeFileSync(multiPath, multi, 'utf8');
console.log('✅ Cleaned multi-model.js (Cache logic removed)');

// 2. Inject Cache logic into sovereign-protocol.js
const protoPath = 'lib/sovereign-protocol.js';
let proto = fs.readFileSync(protoPath, 'utf8');

// Add import
if (!proto.includes("import { semanticCache } from './semantic-cache.js';")) {
  proto = proto.replace("import { piiRedactor } from './pii-redactor.js';", "import { piiRedactor } from './pii-redactor.js';\nimport { semanticCache } from './semantic-cache.js';");
}

// Modify execute signature to accept userId
proto = proto.replace("async execute(prompt, taskType = 'general') {", "async execute(prompt, taskType = 'general', userId = 'global') {");

// Add cache search at the beginning
proto = proto.replace(
  "const chain = [];",
  "const chain = [];\n\n    // HOT MEMORY: O(1) Search before any expensive operations\n    const cachedResult = semanticCache.search(prompt, userId);\n    if (cachedResult) {\n      return { content: cachedResult.content, attestation: { protocol_version: 'SIP/1.0', chain: [], verifiable: true, cached: true } };\n    }"
);

// Add cache store at the end (only if not blocked)
proto = proto.replace(
  "return { content: finalContent, attestation: { protocol_version: 'SIP/1.0', chain, verifiable: true } };",
  "// HOT MEMORY: Store pure response with attestation\n    semanticCache.store(prompt, { content: finalContent }, userId, 0, { verifiable: true, chain });\n    return { content: finalContent, attestation: { protocol_version: 'SIP/1.0', chain, verifiable: true } };"
);

fs.writeFileSync(protoPath, proto, 'utf8');
console.log('✅ Patched sovereign-protocol.js (Cache migrated to Protocol)');

// 3. Update Router to pass userId
const routerPath = 'lib/sovereign-inference-router.mjs';
let router = fs.readFileSync(routerPath, 'utf8');
router = router.replace(
  "const sipResult = await sovereignProtocol.execute(sanitized, req.body?.task_type || 'general');",
  "const sipResult = await sovereignProtocol.execute(sanitized, req.body?.task_type || 'general', req.customer_id || 'global');"
);
fs.writeFileSync(routerPath, router, 'utf8');
console.log('✅ Patched sovereign-inference-router.mjs (userId passed to Protocol)');
