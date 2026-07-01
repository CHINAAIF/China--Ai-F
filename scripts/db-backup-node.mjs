// TRUNKIA - Database Backup using Node.js (for Termux compatibility)
import { Pool } from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const BACKUP_DIR = './db-backups';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_FILE = `${BACKUP_DIR}/neon_backup_${TIMESTAMP}.json`;

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });

try {
    const tables = await pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    
    const backup = {};
    for (const row of tables.rows) {
        const tableName = row.table_name;
        const data = await pool.query(`SELECT * FROM ${tableName}`);
        backup[tableName] = data.rows;
    }
    
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
    console.log(`✅ Backup created: ${BACKUP_FILE}`);
    console.log(`✅ Tables backed up: ${tables.rows.length}`);
    await pool.end();
    process.exit(0);
} catch (error) {
    console.error(`❌ Backup failed: ${error.message}`);
    process.exit(1);
}
