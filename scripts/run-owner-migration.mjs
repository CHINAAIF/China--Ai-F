import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

async function runMigration() {
  const ownerUrl = process.argv[2];

  if (!ownerUrl || (!ownerUrl.startsWith('postgres://') && !ownerUrl.startsWith('postgresql://'))) {
    console.error('❌ Invalid or missing connection string.');
    console.error('Usage: node scripts/run-owner-migration.mjs "postgres://user:pass@host/db"');
    process.exit(1);
  }

  const migrationFile = path.resolve(process.cwd(), 'migrations/fix_canary_tokens_protection.sql');
  
  if (!fs.existsSync(migrationFile)) {
    console.error(`❌ Migration file not found: ${migrationFile}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');
  const client = new Client({ connectionString: ownerUrl });

  try {
    console.log('Connecting to database as owner...');
    await client.connect();
    console.log('✅ Connected. Executing migration...\n');
    
    await client.query(sql);
    console.log('✅ Migration executed successfully!');
    
    const res = await client.query("SELECT rulename FROM pg_rules WHERE schemaname = 'public' AND tablename = 'canary_tokens'");
// [AUDIT REDACTED]     console.log('\n=== Verification: Rules on canary_tokens ===');
    console.table(res.rows);

  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigration();
