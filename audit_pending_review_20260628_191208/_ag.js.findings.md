⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading          
**1. Suppress SSL certificate verification (Potential MITM)**  
**Location:** Line where the client pool is created (var pool = new pg.Pool...).  

**Explanation:** The pool is instantiated with ssl:{rejectUnauthorized:false}, which tells the PostgreSQL driver to accept *any* TLS certificate, even if it is self‑signed or otherwise invalid. An attacker could therefore intercept the connection (Man‑in‑the‑Middle) and present a bogus certificate without the client detecting it.  

**Fix (minimal change):** Set rejectUnauthorized:true (or remove the explicit override and let the driver validate certificates).  

```diff
- var pool = new pg.Pool({connectionString:url,ssl:{rejectUnauthorized:false}});
+ var pool = new pg.Pool({connectionString:url,ssl:{rejectUnauthorized:true}});
```

---

**2. Unhandled promise rejections from database queries**  
**Location:** The two await pool.query(...) calls (lines 8 – 10 and line 14).  

**Explanation:** If a query fails (network error, syntax error, permission denied, etc.) the resulting promise is rejected. Since there is no try/catch or .catch() handling, the rejection propagates as an *unhandled promise rejection*, which in Node ≥15 will terminate the process with a non‑zero exit code and may leak sensitive stack traces.  

**Fix (minimal change):** Wrap each await in a try/catch (or wrap the whole block, see below).  

```diff
- var r = await pool.query(...);
+ let r;
+ try { r = await pool.query(...); } 
+ catch (e) { console.error('Query error:', e); process.exit(1); }

- var c = await pool.query(...);
+ let c;


