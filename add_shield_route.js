import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/index.js';
var c = fs.readFileSync(p, 'utf8');

// Add import after sovereignRouter
var importLine = "import sovereignRouter from './routes/sovereign.js';";
var newImport = importLine + "\nimport shieldRouter from './routes/shield.js';";
c = c.replace(importLine, newImport);

// Add route after sovereign route
var routeLine = "app.use('/v1/sovereign', sovereignRouter);";
var newRoute = routeLine + "\napp.use('/v1/shield', shieldRouter);";
c = c.replace(routeLine, newRoute);

fs.writeFileSync(p, c, 'utf8');
console.log('OK: shield routes added to index.js');

// Verify
var c2 = fs.readFileSync(p, 'utf8');
console.log('has shield import: ' + c2.includes("import shieldRouter"));
console.log('has shield route: ' + c2.includes("app.use('/v1/shield'"));
console.log('new line count: ' + c2.split('\n').length);
