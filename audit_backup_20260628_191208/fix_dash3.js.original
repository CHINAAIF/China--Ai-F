import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/index.js';
var c = fs.readFileSync(p, 'utf8');

// Fix: the original has trailing commas, need exact match
c = c.replace(
  'heartbeat: heartbeat.rows,',
  'heartbeat_count: heartbeat.rows.length,'
);
c = c.replace(
  'sovereign: { operations: ops.rows },',
  'sovereign: { operations_count: ops.rows[0]?.ops || 0 },'
);
c = c.replace(
  'diagnostics: { repairs: repairs.rows },',
  'diagnostics: { repairs_count: repairs.rows[0]?.count || 0 },'
);
c = c.replace(
  'tasks: { queue: tasks.rows },',
  'tasks: { queue_count: tasks.rows[0]?.count || 0 },'
);

// Fix all error exposures - exact match
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message }); }\n  } catch(e) { res.status(500).json({ error: 'internal_error' });\n\n// ── Judicial Stats",
  "} catch(e) { res.status(500).json({ error: 'internal_error' });\n\n// ── Judicial Stats"
);
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message });\n\n// ── Redundancy",
  "} catch(e) { res.status(500).json({ error: 'internal_error' });\n\n// ── Redundancy"
);
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message });\n\n// ── Performance",
  "} catch(e) { res.status(500).json({ error: 'internal_error' });\n\n// ── Performance"
);
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message, request_id: req.requestId });\n\n// ── 404",
  "} catch(e) { res.status(500).json({ error: 'internal_error', request_id: req.requestId });\n\n// ── 404"
);
c = c.replace(
  "console.error('Unhandled:', err.message);\n  res.status(500).json({ error: 'internal_error', request_id: req.requestId });",
  "console.error('Unhandled:', err.code || err.message);\n  res.status(500).json({ error: 'internal_error', request_id: req.requestId });"
);

fs.writeFileSync(p, c, 'utf8');
var v = fs.readFileSync(p, 'utf8');
console.log('has agent_name: ' + v.includes('agent_name'));
console.log('has heartbeat.rows: ' + v.includes('heartbeat.rows'));
console.log('has ops.rows: ' + v.includes('ops.rows'));
console.log('has repairs.rows: ' + v.includes('repairs.rows'));
console.log('has tasks.rows: ' + v.includes('tasks.rows'));
console.log('has e.message: ' + v.includes('e.message'));
console.log('has err.message: ' + v.includes('err.message'));
console.log('lines: ' + v.split('\n').length);
