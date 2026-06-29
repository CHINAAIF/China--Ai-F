⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading          
**1. Missing error handling around all I/O operations**  
**Where:** whole script (lines 1‑28)  
**Risk:** If the file does not exist, is locked, or the filesystem is unwritable, fs.readFileSync / fs.writeFileSync will throw an uncaught exception that crashes the Node process. In a production deployment this could bring the service down unexpectedly.  
**Fix:** Wrap the operations in try…catch and report the error instead of allowing the process to terminate.  

```diff
- var p = '/data/.../index.js';
- var c = fs.readFileSync(p, 'utf8');
+ const p = '/data/.../index.js';
+ try {
+     if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
+     var c = fs.readFileSync(p, 'utf8');
```

...  
```diff
- fs.writeFileSync(p, c, 'utf8');
- console.log('OK');
+     fs.writeFileSync(p, c, 'utf8');
+     console.log('OK');
+ } catch (err) {
+     console.error('I/O error:', err);
+     process.exit(1);
+ }
```

---

**2. Single‑instance replace – only the first match is changed**  
**Where:** lines 4‑8 (c = c.replace(...))  
**Risk:** If the same code fragment (e.g., heartbeat: heartbeat.rows,) appears more than once, only the first occurrence is updated. The unmodified copies will then reference the old variable names leading to runtime errors or crashes in the application that uses index.js.  
**Fix:** Use global regular expressions to replace all occurrences.  

```diff
- c = c.replace('heartbeat: heartbeat.rows,', 'heartbeat_count: heartbeat.rows.length,');
+ c = c.replace(/heartbeat: heartbeat\.rows,/g, 'heartbeat_count: heartbeat.rows.length,');
- c = c.replace('sovereign: { operations: ops.rows },', 'sovereign: { operations_count: ops.rows[0]?.ops || 0 },');
+ c = c.replace(/sovereign:\s*{ operations: ops\.rows },/g, 'sovereign: { operations_count: ops.rows[0]?.ops || 0 },');
- c = c.replace('diagnostics: { repairs: repairs.rows },', 'diagnostics: { repairs_count: repairs.rows[0]?.count

