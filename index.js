import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

var app = express();
var PORT = process.env.PORT || 8080;

// Fix Neon DB URL - remove channel_binding that breaks pg library
function fixDbUrl(url) {
  if (!url) return null;
  var parts = url.split('?');
  if (parts.length < 2) return url;
  var params = parts[1].split('&');
  var filtered = [];
  for (var i = 0; i < params.length; i++) {
    if (params[i].indexOf('channel_binding=') !== 0) {
      filtered.push(params[i]);
    }
  }
  return parts[0] + '?' + filtered.join('&');
}

var pool = null;
function getPool() {
  if (!pool) {
    var dbUrl = fixDbUrl(process.env.DATABASE_URL);
    if (!dbUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Route 1: Health - no DB needed, responds instantly
app.get('/health', function(req, res) {
  res.json({ status: 'ok', port: PORT, phase: 2, time: new Date().toISOString() });
});

// Route 2: Ping - no DB needed
app.get('/ping', function(req, res) {
  res.json({ pong: true, ts: Date.now() });
});

// Route 3: Test DB connection
app.get('/api/test-db', async function(req, res) {
  try {
    var p = getPool();
    var result = await p.query('SELECT now() as db_time, version() as db_version');
    if (result && result.rows && result.rows[0]) {
      res.json({
        db_connected: true,
        db_time: result.rows[0].db_time,
        db_version: result.rows[0].db_version
      });
    } else {
      res.status(500).json({ db_connected: false, error: 'No rows returned from DB' });
    }
  } catch (e) {
    console.error('[DB ERROR]', e.message);
    res.status(500).json({ db_connected: false, error: e.message });
  }
});

// Start server
app.listen(PORT, function() {
  console.log('TRUNKIA Phase2 on :' + PORT);
});
