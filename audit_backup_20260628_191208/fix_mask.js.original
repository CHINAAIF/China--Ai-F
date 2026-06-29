import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var p = HOME + '/agents/governance/safety-compliance-layer.js';
var c = fs.readFileSync(p, 'utf8');
c = c.replace('maskValue(maskgedText', 'maskValue(maskedText');
fs.writeFileSync(p, c, 'utf8');
console.log('OK: fixed maskgedText typo');
