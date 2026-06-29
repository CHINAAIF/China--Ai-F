⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading          
**1. Unhandled Promise Rejections / Resource Leak**  
**File:** ./diag_bench.js  
**Issue location:** Lines 5‑32 (the body of async function diag())

> **Why it matters:**  
> The script performs several await pool.query(...) calls. If any of these queries reject (e.g., due to network failure, bad connection parameters, or SQL syntax errors), the rejection is **unhandled**. Node will emit an unhandled‑rejection warning, terminate the process without cleaning up the connection pool, and potentially leave pending connections open. This can lead to both security‑related (exposed database credentials through process logs) and operational failures (resource exhaustion).

> **Fix – wrap the entire async body in a try / catch / finally** block and ensure that the pool is always closed, even when an error occurs. Also log the error for visibility.

```diff
- async function diag() {
-   var t1 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_accuracy_registry' ORDER BY ordinal_position");
-   console.log('=== model_accuracy_registry ===');
-   t1.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });
+ async function diag() {
+   try {
+     var t1 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_accuracy_registry' ORDER BY ordinal_position");
+     console.log('=== model_accuracy_registry ===');
+     t1.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

    var t2 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_benchmarks' ORDER BY ordinal_position");
    console.log('\n=== model_benchmarks ===');
    t2.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

    var t3 = await pool.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='model_consensus' ORDER BY ordinal_position");
    console.log('\n=== model_consensus ===');
    t3.rows.forEach(function(r) { console.log('  ' + r.column_name + ' | ' + r.data_type + ' | null:' + r.is_nullable); });

    var c1 = await pool.query("SELECT count(*) as c FROM model_accuracy_registry");
    var c2 = await pool.query("SELECT count(*) as c FROM model_b

