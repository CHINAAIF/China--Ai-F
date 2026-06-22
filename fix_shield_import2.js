import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/routes/shield.js';
var c = fs.readFileSync(p, 'utf8');
// Revert to direct pg import (works locally and on Railway)
c = c.replace("import { pool } from '../utils/db.js';", "import pg from 'pg';");
c = c.replace("// Using shared pool from db.js", "var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });");
fs.writeFileSync(p, c, 'utf8');
console.log('OK: reverted to direct pg import');
console.log('has pg import: ' + c.includes("import pg from"));
console.log('has pool: ' + c.includes("new pg.Pool"));
