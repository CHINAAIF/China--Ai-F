import { getPool, generateDbToken } from '../lib/db.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging' });

const pool = getPool('main', generateDbToken('scripts/migrate-quota'));

async function runMigration() {
  try {
    console.log('[MIGRATE] Checking user_quota table...');
    // Check if columns exist, if not add them
    await pool.query(`
      ALTER TABLE user_quota 
      ADD COLUMN IF NOT EXISTS held_quota BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_consumed BIGINT DEFAULT 0;
    `);
    console.log('[MIGRATE] [✓] Quota columns ensured (held_quota, total_consumed).');
  } catch (err) {
    // If table doesn't exist at all, create it
    if (err.message.includes('does not exist')) {
      console.log('[MIGRATE] Table not found. Creating user_quota table...');
      await pool.query(`
        CREATE TABLE user_quota (
          user_id TEXT PRIMARY KEY,
          remaining_quota BIGINT DEFAULT 0,
          held_quota BIGINT DEFAULT 0,
          total_consumed BIGINT DEFAULT 0
        );
      `);
      console.log('[MIGRATE] [✓] user_quota table created.');
    } else {
      console.error('[MIGRATE] Error:', err.message);
    }
  }
}
runMigration();
