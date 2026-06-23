import fs from 'fs';
var H = '/data/data/com.termux/files/home/downloads/China--Ai-F';
var ix = H + '/index.js';
var ic = fs.readFileSync(ix, 'utf8');
var rl = 'app.use((req, res, next) => { if (["/health","/ping","/v1/health","/v1/shield/status"].includes(req.path)) { var ip = req.ip || "x"; if (!global._rl) global._rl = {}; if (!global._rl[ip] || Date.now() - global._rl[ip].r > 60000) global._rl[ip] = {c:0,r:Date.now()}; global._rl[ip].c++; if (global._rl[ip].c > 60) return res.status(429).json({error:"rate_limited"}); } next(); });';
ic = ic.replace('app.use("/v1/health", healthRouter);', 'app.use("/v1/health", healthRouter);\n' + rl);
fs.writeFileSync(ix, ic, 'utf8');
console.log('OK: index');
