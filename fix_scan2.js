import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

var old = "if (rule.action === 'mask') {\n          maskedText = maskValue(maskedText, rule.rule_name);\n          } else if (rule.action === 'block') {\n          maskedText = maskValue(maskgedText, rule.rule_name);\n          }";

var rep = "if (rule.action === 'mask' || rule.action === 'block') {\n          var mR = new RegExp(rule.pattern, 'gi');\n          maskedText = maskedText.replace(mR, function(m) {\n            if (m.length <= 3) return '***';\n            return m[0] + '*'.repeat(m.length - 2) + m[m.length - 1];\n          });\n        }";

if (c.includes(old)) {
  c = c.replace(old, rep);
  fs.writeFileSync(p, c, 'utf8');
  console.log('OK: replaced');
} else {
  console.log('NOT FOUND');
  // Try character-by-character
  var idx = c.indexOf("rule.action === 'mask'");
  if (idx > -1) {
    var end = c.indexOf('} catch', idx);
    console.log('Block: [' + c.substring(idx, end) + ']');
  }
}
