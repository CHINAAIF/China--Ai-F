import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

var url = process.env.DATABASE_URL;
if (!url) { console.log('ERROR: no DATABASE_URL'); process.exit(1); }

var parts = url.split('?');
var fixed = parts[0] + '?' + parts.slice(1).join('?').split('&').filter(function(p) {
  return p.indexOf('channel_binding=') !== 0;
}).join('&');

var pool = new pg.Pool({ connectionString: fixed, ssl: { rejectUnauthorized: true } });

var tables = [
  'models',
  'model_geopolitical_risk',
  'model_pricing_tiers',
  'model_capabilities',
  'model_benchmarks',
  'model_accuracy_registry'
];

try {
  for (var t = 0; t < tables.length; t++) {
    var r = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
      ['public', tables[t]]
    );
    console.log('--- ' + tables[t] + ' (' + r.rows.length + ' cols) ---');
    for (var i = 0; i < r.rows.length; i++) {
      console.log('  ' + r.rows[i].column_name + ' | ' + r.rows[i].data_type);
    }
  }
} catch (e) {
  console.log('QUERY ERROR: ' + e.message);
}

await pool.end();
console.log('DONE');
