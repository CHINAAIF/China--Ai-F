#!/bin/bash
FILE="$HOME/downloads/China--Ai-F/lib/db.js"

node - << 'JS'
const fs = require('fs');
const path = process.env.HOME + '/downloads/China--Ai-F/lib/db.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /const sslConfig = isProduction[\s\S]*?\}\s*:\s*\{[^}]*\};/,
  'const sslConfig = { rejectUnauthorized: false };'
);

fs.writeFileSync(path, content, 'utf8');
console.log('✅ SSL fix applied successfully');
JS
