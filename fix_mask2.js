import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');

// Fix all maskValue regexes - add g flag and fix patterns
c = c.replace(
  "return text.replace(/[\\\\w.-]+@[\\\\w.-]+\\\\.\\\\w{2,}/, '***@$2')",
  "return text.replace(/[\\w.-]+@[\\w.-]+\\.\\w{2,}/g, '***@$2')"
);
c = c.replace(
  "return text.replace(/\\\\d{3}[-.]?\\\\d{3}[-.]?\\\\d{4}/, '***-***-****')",
  "return text.replace(/\\d{3}[-.]?\\d{3}[-.]?\\d{4}/g, '***-***-****')"
);
c = c.replace(
  "return text.replace(/\\\\d{4}[- ]?\\\\d{4}[- ]?\\\\d{4}[- ]?\\\\d{4}/, '****-****-****-****')",
  "return text.replace(/\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}/g, '****-****-****-****')"
);
c = c.replace(
  "return text.replace(/((?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\\\d{4})\\\\d+/, '$1***')",
  "return text.replace(/((?:SA|IQ|SY|JO|AE|BH|KW|QA|OM|YE|LB)\\d{4})\\d+/g, '$1***')"
);
c = c.replace(
  "return text.replace(/\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}/, '*.***.***.*')",
  "return text.replace(/\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/g, '*.***.***.*')"
);
c = c.replace(
  "return text.replace(/\\\\d{3}-\\\\d{2}-\\\\d{4}/, '***-**-****')",
  "return text.replace(/\\d{3}-\\d{2}-\\d{4}/g, '***-**-****')"
);
c = c.replace(
  "return text.replace(/\\b([A-Z]{2}\\\\d{2})[A-Z0-9]{4,30}\\\\b/, '$1****')",
  "return text.replace(/([A-Z]{2}\\d{2})[A-Z0-9]{4,30}/g, '$1****')"
);

fs.writeFileSync(p, c, 'utf8');
console.log('OK: all maskValue regexes fixed with g flag');

// Verify
var c2 = fs.readFileSync(p, 'utf8');
var maskCount = (c2.match(/maskValue/g) || []).length;
var gFlagCount = (c2.match(/\/g,/g) || []).length;
console.log('maskValue calls: ' + maskCount + ' | g flags: ' + gFlagCount);
