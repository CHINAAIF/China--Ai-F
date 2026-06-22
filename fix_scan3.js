import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

// Find exact position of the mask/block block
var s = c.indexOf("rule.action === 'mask'");
var e = c.indexOf('catch', s);
var block = c.substring(s, e);
console.log('FOUND block length: ' + block.length);

// Replace everything from start to end of block with DB-based masking
var newBlock = [
  "rule.action === 'mask' || rule.action === 'block') {",
  "          try {",
  "            var mr = new RegExp(rule.pattern, 'gi');",
  "            maskedText = maskedText.replace(mr, function(match) {",
  "              if (match.length <= 2) return '**';",
  "              return match[0] + '*'.repeat(match.length - 2) + match[match.length - 1];",
  "            });",
  "          } catch(erm) { /* skip mask error */ }",
  "        }"
].join('\n');

// Build new code: find the 'if (' before the block
var ifStart = c.lastIndexOf('if (', s);
var blockEnd = c.indexOf('}', e - 5);
blockEnd = c.indexOf('\n', blockEnd) + 1;

c = c.substring(0, ifStart) + 'if (' + newBlock + '\n' + c.substring(blockEnd);
fs.writeFileSync(p, c, 'utf8');
console.log('OK: replaced mask block at ' + ifStart + ' to ' + blockEnd);
