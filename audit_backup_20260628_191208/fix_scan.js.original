import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

// Replace the masking logic inside scanText — use DB regex directly
var oldMask = "if (rule.action === 'mask') {\n          maskedText = maskValue(maskgedText, rule.rule_name);\n          } else if (rule.action === 'block') {\n          maskedText = maskValue(maskgedText, rule.rule_name);\n          }";
var newMask = "if (rule.action === 'mask' || rule.action === 'block') {\n          var mRegex = new RegExp(rule.pattern, 'gi');\n          maskedText = maskedText.replace(mRegex, function(m) {\n            if (m.length <= 3) return '***';\n            return m[0] + '*'.repeat(m.length - 2) + m[m.length - 1];\n          });\n        }";

if (c.includes(oldMask)) {
  c = c.replace(oldMask, newMask);
  console.log('OK: scanText masking fixed to use DB regex');
} else {
  console.log('Pattern not found, trying alternate...');
  // Find the catch block in scanText and replace masking section
  var idx1 = c.indexOf('rule.action === \'mask\'');
  var idx2 = c.indexOf('catch(_) {}', idx1);
  if (idx1 > -1 && idx2 > -1) {
    console.log('Found mask block at ' + idx1 + ' to ' + idx2);
    console.log('Content: ' + c.substring(idx1 - 5, idx2 + 15));
  }
}

fs.writeFileSync(p, c, 'utf8');
