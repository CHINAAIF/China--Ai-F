import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

// Find and replace entire maskValue function
var oldStart = c.indexOf('function maskValue(text, type) {');
var oldEnd = c.indexOf('\n}', oldStart) + 2;
if (oldStart === -1) { console.log('ERROR: maskValue not found'); process.exit(1); }

var newFunc = [
  'function maskValue(text, type) {',
  '  if (!text) return text;',
  '  switch(type) {',
  '    case \'email_pii\': return text.replace(/[\\w.-]+@[\\w.-]+\\.\\w{2,}/g, \'***@$2\');',
  '    case \'phone_pii\': return text.replace(/\\d{3}[-.]?\\d{3}[-.]?\\d{4}/g, \'***-***-****\');',
  '    case \'credit_card_financial\': return text.replace(/\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}/g, \'****-****-****-****\');',
  '    case \'national_id_pii\': return text.replace(/((?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\d{4})\\d+/g, \'$1***\');',
  '    case \'ip_address\': return text.replace(/\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/g, \'*.***.***.*\');',
  '    case \'ssn_pii\': return text.replace(/\\d{3}-\\d{2}-\\d{4}/g, \'***-**-****\');',
  '    case \'bank_account_financial\': return text.replace(/([A-Z]{2}\\d{2})[A-Z0-9]{4,30}/g, \'$1****\');',
  '    default: return text.replace(/./g, \'*\');',
  '  }',
  '}'
].join('\n');

c = c.substring(0, oldStart) + newFunc + c.substring(oldEnd);
fs.writeFileSync(p, c, 'utf8');

// Verify
var c2 = fs.readFileSync(p, 'utf8');
var gCount = (c2.match(/\/g,/g) || []).length;
console.log('OK: maskValue rewritten | g flags in file: ' + gCount);
