import fs from 'fs';
var H = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var sh = H + '/routes/shield.js';
var shc = fs.readFileSync(sh, 'utf8');
shc = shc.replace('samples: findings[0].samples', 'samples_count: findings[0].count');
fs.writeFileSync(sh, shc, 'utf8');
console.log('OK: shield');
