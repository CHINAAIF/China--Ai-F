import dotenv from 'dotenv'; dotenv.config();
import pg from 'pg';
var pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
async function diag() {
  var t1 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_accuracy_registry' ORDER BY ordinal_position");
  console.log('=== model_accuracy_registry ===');
  t1.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

  var t2 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_benchmarks' ORDER BY ordinal_position");
  console.log('\n=== model_benchmarks ===');
  t2.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

  var t3 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_consensus' ORDER BY ordinal_position");
  console.log('\n=== model_consensus ===');
  t3.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

  var c1 = await pool.query("SELECT count(*) as c FROM model_accuracy_registry");
  var c2 = await pool.query("SELECT count(*) as c FROM model_benchmarks");
  console.log('\nmodel_accuracy_registry rows: ' + c1.rows[0].c);
  console.log('model_benchmarks rows: ' + c2.rows[0].c);

  // Check existing data
  if (c1.rows[0].c > 0) {
    var sample = await pool.query("SELECT * FROM model_accuracy_registry LIMIT 3");
    console.log('\nsample accuracy data:');
    sample.rows.forEach(function(r) { console.log('  ' + JSON.stringify(r)); });
  }

  await pool.end();
}
diag();
