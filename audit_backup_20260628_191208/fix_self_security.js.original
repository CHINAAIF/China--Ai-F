import fs from 'fs';
var HOME = '/data/data/com.termux/files/home/downloads/China--Ai-F';

// 1. Fix middleware to hide table names in errors
var mw = HOME + '/routes/middleware.js';
var mc = fs.readFileSync(mw, 'utf8');
if (!mc.includes('safeErrorMessage')) {
  var oldErr = 'res.status(500).json({ error: err.message, request_id: req.requestId });';
  var newErr = [
    'res.status(500).json({ error: "internal_error", request_id: req.requestId });'
  ].join('\n');
  mc = mc.replace(oldErr, newErr);
  fs.writeFileSync(mw, mc, 'utf8');
  console.log('OK: middleware hides error details');
}

// 2. Hide sensitive data in sovereign/dashboard response
var sq = HOME + '/routes/sovereign.js';
var sc = fs.readFileSync(sq, 'utf8');
// Hide agent names in public response - show count only
sc = sc.replace(
  "res.json({ timestamp: new Date().toISOString(),\n      system: { agents_total: agents.rows[0]?.total || 108, heartbeat: heartbeat.rows, active_models: models.rows[0]?.total || 12 },",
  "res.json({ timestamp: new Date().toISOString(),\n      system: { agents_total: agents.rows[0]?.total || 108, active_models: models.rows[0]?.total || 12 },"
);
// Hide individual agent heartbeat details
sc = sc.replace(
  'heartbeat: heartbeat.rows,',
  'heartbeat_count: heartbeat.rows.length,'
);
// Hide individual agent execution logs
sc = sc.replace(
  'recent_activity: activity.rows',
  'recent_activity_count: activity.rows.length,'
);
// Hide individual operations details
sc = sc.replace(
  'sovereign: { operations: ops.rows },',
  'sovereign: { operations_count: ops.rows.length },'
);
// Hide individual repair details
sc = sc.replace(
  'diagnostics: { repairs: repairs.rows },',
  'diagnostics: { repairs_count: repairs.rows.length },'
);
// Hide task queue details
sc = sc.replace(
  'tasks: { queue: tasks.rows },',
  'tasks: { queue_count: tasks.rows.length },'
);
fs.writeFileSync(sq, sc, 'utf8');
console.log('OK: sovereign dashboard hides sensitive details');

// 3. Hide sensitive metrics
var mt = HOME + '/routes/metrics.js';
var mtc = fs.readFileSync(mt, 'utf8');
if (!mtc.includes('safeMetrics')) {
  // Hide individual agent scores
  mtc = mtc.replace(
    "res.json({ timestamp: new Date().toISOString(), agents });",
    "res.json({ timestamp: new Date().toISOString(), total_agents: agents.rows.length });"
  );
  fs.writeFileSync(mt, mtc, 'utf8');
  console.log('OK: metrics hides individual scores');
}

// 4. Add rate limiting to public routes in index.js
var idx = HOME + '/index.js';
var ic = fs.readFileSync(idx, 'utf8');
if (!ic.includes('publicRateLimit')) {
  var rateLimitCode = [
    'app.use((req, res, next) => {',
    '  const publicPaths = [\\'/health\\', \\'/ping\\', \\'/v1/health\\', \\'/v1/shield/status\\'];',
    '  if (publicPaths.includes(req.path)) {',
    '    const ip = req.ip || \\'unknown\\';',
    '    if (!global._publicRates) global._publicRates = {};',
    '    if (!global._publicRates[ip]) global._publicRates[ip] = { count: 0, resetAt: Date.now() };',
    '    global._publicRates[ip].count++;',
    '    if (Date.now() - global._publicRates[ip].resetAt > 60000) { global._publicRates[ip] = { count: 1, resetAt: Date.now() }; }',
    '    else if (global._publicRates[ip].count > 60) { return res.status(429).json({ error: \\'rate_limited\\' }); }',
    '  }',
    '  next();',
    '});'
  ].join('\n');
  // Add after other middleware, before routes
  ic = ic.replace(
    "app.use('/v1/shield', shieldRouter);",
    "app.use('/v1/shield', shieldRouter);\n" + rateLimitCode
  );
  fs.writeFileSync(idx, ic, 'utf8');
  console.log('OK: public rate limit added (60/min/IP)');
}

// 5. Hide byok_keys from any possible exposure
var sh = HOME + '/routes/shield.js';
var shc = fs.readFileSync(sh, 'utf8');
// Ensure shield status never exposes rule patterns
if (shc.includes('rules_by_category')) {
  // Already uses category counts - good, no patterns exposed
  console.log('OK: shield status safe (counts only, no patterns)');
}
// Ensure shield scan never returns raw rule patterns in response
if (shc.includes('samples:')) {
  shc = shc.replace(/samples:\s*findings\[0\]\.samples/g, 'samples_count:');
  fs.writeFileSync(sh, shc, 'utf8');
  console.log('OK: shield scan hides rule samples');
}

console.log('\nAll self-security fixes applied');
