import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/index.js';
var c = fs.readFileSync(p, 'utf8');

c = c.replace('heartbeat: heartbeat.rows,', 'heartbeat_count: heartbeat.rows.length,');
c = c.replace('sovereign: { operations: ops.rows },', 'sovereign: { operations_count: ops.rows[0]?.ops || 0 },');
c = c.replace('diagnostics: { repairs: repairs.rows },', 'diagnostics: { repairs_count: repairs.rows[0]?.count || 0 },');
c = c.replace('tasks: { queue: tasks.rows },', 'tasks: { queue_count: tasks.rows[0]?.count || 0 },');

fs.writeFileSync(p, c, 'utf8');
console.log('OK');
var v = fs.readFileSync(p, 'utf8');
console.log('has agent_name: ' + v.includes('agent_name'));
console.log('has heartbeat.rows: ' + v.includes('heartbeat.rows'));
console.log('has operations: ops.rows: ' + v.includes('operations: ops.rows'));
console.log('has repairs.rows: ' + v.includes('repairs.rows'));
console.log('has tasks.rows: ' + v.includes('tasks.rows'));
console.log('has e.message: ' + v.includes('e.message'));
console.log('lines: ' + v.split('\n').length);
