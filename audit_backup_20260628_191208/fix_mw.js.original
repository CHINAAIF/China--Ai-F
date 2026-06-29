import fs from 'fs';
var H = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var mw = H + '/routes/middleware.js';
var mc = fs.readFileSync(mw, 'utf8');
mc = mc.replace('error: err.message,', 'error: "internal_error"');
fs.writeFileSync(mw, mc, 'utf8');
console.log('OK: middleware');
