import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

var oldStart = c.indexOf('function maskValue(text, type) {');
var oldEnd = c.indexOf('\n}', oldStart) + 2;

var newFunc = 'function maskValue(text, type) {\n';
newFunc += '  if (!text) return text;\n';
newFunc += '  var M = {\n';
newFunc += "    'email_pii': [/[\\w.-]+@([\\w.-]+\\.\\w{2,})/g, '***@$1'],\n";
newFunc += "    'phone_pii': [/\\d{3}[-.]?\\d{3}[-.]?\\d{4}/g, '***-***-****'],\n";
newFunc += "    'credit_card_financial': [/\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}/g, '****-****-****-****'],\n";
newFunc += "    'national_id_pii': [/((?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\d{4})\\d+/g, '$1***'],\n";
newFunc += "    'ip_address': [/\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/g, '*.***.***.*'],\n";
newFunc += "    'ssn_pii': [/\\d{3}-\\d{2}-\\d{4}/g, '***-**-****'],\n";
newFunc += "    'bank_account_financial': [/([A-Z]{2}\\d{2})[A-Z0-9]{4,30}/g, '$1****']\n";
newFunc += '  };\n';
newFunc += '  if (M[type]) return text.replace(M[type][0], M[type][1]);\n';
newFunc += "  return text.replace(/./g, '*');\n";
newFunc += '}';

c = c.substring(0, oldStart) + newFunc + c.substring(oldEnd);
fs.writeFileSync(p, c, 'utf8');
console.log('OK: maskValue rewritten with regex literals');
