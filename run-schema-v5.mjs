import { pool } from './lib/db.js';
import fs from 'fs';
async function runWithRetry(sql, partName, retries, delay) {
  for (var i = 0; i < retries; i++) {
    var client = await pool.connect();
    try {
      console.log('[' + partName + '] Executing...');
      await client.query(sql);
      console.log('[' + partName + '] SUCCESS');
      client.release();
      return true;
    } catch (e) {
      client.release();
      console.error('[' + partName + '] RETRY_' + (i+1) + ': ' + e.message);
      if (i === retries - 1) { console.error('[' + partName + '] FAILED'); return false; }
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
async function main() {
  var parts = ['schema-v5-p5a.sql', 'schema-v5-p5b.sql', 'schema-v5-p5c.sql'];
  var failed = false;
  for (var i = 0; i < parts.length; i++) {
    var sql = fs.readFileSync(parts[i], 'utf8');
    var ok = await runWithRetry(sql, parts[i], 3, 5000);
    if (!ok) { failed = true; break; }
  }
  await pool.end();
  if (failed) { process.exitCode = 1; console.error('V5_DEPLOYMENT_FAILED'); }
  else { console.log('V5_MAX_GRADE_DEPLOYED_SUCCESSFULLY'); }
}
main();
