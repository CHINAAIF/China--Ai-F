import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/routes/shield.js';
var c = fs.readFileSync(p, 'utf8');
// Replace direct pg import with shared db pool
c = c.replace("import pg from 'pg';", "import { pool } from '../utils/db.js';");
// Remove the local pool creation
c = c.replace("var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });", "// Using shared pool from db.js");
fs.writeFileSync(p, c, 'utf8');
console.log('OK: shield.js now uses shared db pool');
var c2 = fs.readFileSync(p, 'utf8');
console.log('has direct pg import: ' + c2.includes("import pg from"));
console.log('has local Pool: ' + c2.includes("new pg.Pool"));
