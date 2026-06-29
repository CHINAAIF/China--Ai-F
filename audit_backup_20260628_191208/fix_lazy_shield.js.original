import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/index.js';
var c = fs.readFileSync(p, 'utf8');
// Replace eager import with lazy loading
c = c.replace("import shieldRouter from './routes/shield.js';", "// shield loaded lazily below");
// Replace eager route registration with lazy
c = c.replace("app.use('/v1/shield', shieldRouter);", "app.use('/v1/shield', async (req, res, next) => { try { const { default: sr } = await import('./routes/shield.js'); sr(req, res, next); } catch(e) { res.status(500).json({ error: 'shield_load_error: ' + e.message }); } });");
fs.writeFileSync(p, c, 'utf8');
console.log('OK: shield now lazy-loaded');
console.log('has lazy: ' + c.includes('await import'));
