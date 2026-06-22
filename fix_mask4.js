import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

var oldStart = c.indexOf('function maskValue(text, type) {');
var oldEnd = c.indexOf('\n}', oldStart) + 2;

var newFunc = 'function maskValue(text, type) {\n';
newFunc += '  if (!text) return text;\n';
newFunc += '  var R = function(pat, flags, rep) { return text.replace(new RegExp(pat, flags), rep); };\n';
newFunc += '  switch(type) {\n';
newFunc += '    case \'email_pii\': return R(\'[\\\\w.-]+@([\\\\w.-]+\\\\.\\\\w{2,})\', \'g\', \'***@$1\');\n';
newFunc += '    case \'phone_pii\': return R(\'\\\\d{3}[-.]?\\\\d{3}[-.]?\\\\d{4}\', \'g\', \'***-***-****\');\n';
newFunc += '    case \'credit_card_financial\': return R(\'\\\\d{4}[- ]?\\\\d{4}[- ]?\\\\d{4}[- ]?\\\\d{4}\', \'g\', \'****-****-****-****\');\n';
newFunc += '    case \'national_id_pii\': return R(\'((?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\\\d{4})\\\\d+\', \'g\', \'$1***\');\n';
newFunc += '    case \'ip_address\': return R(\'\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\', \'g\', \'*.***.***.*\');\n';
newFunc += '    case \'ssn_pii\': return R(\'\\\\d{3}-\\\\d{2}-\\\\d{4}\', \'g\', \'***-**-****\');\n';
newFunc += '    case \'bank_account_financial\': return R(\'([A-Z]{2}\\\\d{2})[A-Z0-9]{4,30}\', \'g\', \'$1****\');\n';
newFunc += '    default: return R(\'.\', \'g\', \'*\');\n';
newFunc += '  }\n';
newFunc += '}';

c = c.substring(0, oldStart) + newFunc + c.substring(oldEnd);
fs.writeFileSync(p, c, 'utf8');
console.log('OK: maskValue rewritten with new RegExp');
