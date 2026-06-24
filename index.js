import 'dotenv/config';
import express from 'express';
var app = express();
var PORT = process.env.PORT || 5000;
app.get('/health', function(req, res) { res.json({ status: 'ok', time: new Date().toISOString() }); });
app.get('/ping', function(req, res) { res.json({ ok: true }); });
app.listen(PORT, '0.0.0.0', function() { console.log('MINIMAL SERVER on ' + PORT); });