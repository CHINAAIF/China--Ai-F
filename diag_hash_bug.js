import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
import crypto from 'crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized: true} });
async function diag() {
  try {
    // 1. Is event_log a view or table?
    var t = await pool.query("SELECT table_type FROM information_schema.tables WHERE table_name='event_log'");
    console.log('table_type: ' + t.rows[0].table_type);

    // 2. Any triggers on event_log?
    var tr = await pool.query("SELECT trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE event_object_table='event_log'");
    console.log('triggers: ' + tr.rows.length);
    tr.rows.forEach(function(r) { console.log('  ' + r.trigger_name + ' | ' + r.event_manipulation + ' | ' + r.action_statement); });

    // 3. Any rules on event_log?
    var ru = await pool.query("SELECT * FROM pg_rules WHERE tablename='event_log'");
    console.log('rules: ' + ru.rows.length);

    // 4. RLS policies?
    var rl = await pool.query("SELECT policyname, permissive, cmd, qual FROM pg_policies WHERE tablename='event_log'");
    console.log('rls policies: ' + rl.rows.length);
    rl.rows.forEach(function(r) { console.log('  ' + r.policyname + ' | ' + r.cmd); });

    // 5. Get ONE bad row and try manual update
    var one = await pool.query("SELECT id, payload::text as raw_text, length(payload::text) as len FROM event_log WHERE payload_hash='computing' LIMIT 1");
    if (one.rows.length > 0) {
      var row = one.rows[0];
      console.log('\none bad row:');
      console.log('  id: ' + row.id);
      console.log('  payload length: ' + row.len);
      console.log('  payload preview: ' + row.raw_text.substring(0, 100));

      var hash = crypto.createHash('sha256').update(row.raw_text, 'utf8').digest('hex');
      console.log('  computed hash: ' + hash.substring(0, 30) + '...');

      // Try direct update
      var up = await pool.query('UPDATE event_log SET payload_hash=$1 WHERE id=$2', [hash, row.id]);
      console.log('  update rowCount: ' + up.rowCount);

      // Check if it changed
      var check = await pool.query('SELECT payload_hash FROM event_log WHERE id=$1', [row.id]);
      console.log('  hash after update: ' + check.rows[0].payload_hash.substring(0, 30) + '...');
    } else {
      console.log('no bad rows found with exact computing');
      // Try with LIKE
      var one2 = await pool.query("SELECT id, payload_hash FROM event_log WHERE payload_hash LIKE 'comput%' LIMIT 3");
      console.log('rows with computing%: ' + one2.rows.length);
      one2.rows.forEach(function(r) { console.log('  ' + r.id + ' | ' + r.payload_hash); });
    }

    // 6. Check column default
    var def = await pool.query("SELECT column_name, column_default FROM information_schema.columns WHERE table_name='event_log' AND column_name='payload_hash'");
    console.log('\npayload_hash default: ' + JSON.stringify(def.rows[0].column_default));

    // 7. Check if column is read-only (generated)
    var gen = await pool.query("SELECT column_name, is_generated FROM information_schema.columns WHERE table_name='event_log' AND column_name='payload_hash'");
    console.log('is_generated: ' + gen.rows[0].is_generated);

  } catch(e) { console.error('ERR: ' + e.message); }
  await pool.end();
}
diag();
