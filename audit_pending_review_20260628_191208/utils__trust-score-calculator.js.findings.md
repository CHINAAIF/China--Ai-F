⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading⣾  Loading⣽  Loading⣻  Loading⢿  Loading⡿  Loading⣟  Loading⣯  Loading⣷  Loading          
**1. File:** ./utils/trust-score-calculator.js  
**Location:** ts.batch(8).then(r=>{...}); (first line after class definition)  
**Risk:** **Unhandled Promise Rejection** – if any of the asynchronous operations inside batch() (e.g., the pool query to retrieve active models or the calc() call that internally catches but may still throw a non‑handled error from the pool) reject, the rejection will propagate out of the top‑level promise chain. Node will terminate the process with an unhandled rejection warning, potentially masking the failure and leaving the service in an unpredictable state.  
**Fix:** Add a .catch() handler that logs the error and exits cleanly.

```diff
- ts.batch(8).then(r=>{console.log('=== TRUST SCORE ===');for(const x of r){console.log(x.trust.toString().padStart(3),x.level.padEnd(12),'|',x.model.padEnd(28),'|',x.color);console.log('  acc:',x.factors.acc,'| rep:',x.factors.rep,'| saf:',x.factors.saf,'| stb:',x.factors.stb);}console.log('\n🎯 TRUST SCORE OPERATIONAL!');process.exit(0);});
+ ts.batch(8)
+   .then(r=>{
+     console.log('=== TRUST SCORE ===');
+     for(const x of r){
+         console.log(x.trust.toString().padStart(3),x.level.padEnd(12),'|',x.model.padEnd(28),'|',x.color);
+         console.log('  acc:',x.factors.acc,'| rep:',x.factors.rep,'| saf:',x.factors.saf,'| stb:',x.factors.stb);
+     }
+     console.log('\n🎯 TRUST SCORE OPERATIONAL!');
+     process.exit(0);
+   })
+   .catch(err=>{
+     console.error('TRUST SCORE FAILED:', err);
+     process.exit(1);
+   });
```

---

**2. File:** ./utils/trust-score-calculator.js  
**Location:** Inside method calc(slug) – each try { … } catch(e) {} block (lines ~5‑30)  
**Risk:** **Silently swallowing database errors** – The code catches all query errors and swallows them (catch(e){}), leaving the trust factors (acc, rep, saf, stb) at their initial default values. This can give an attacker (or a malicious administrator) the impression that a model has a high/default trust rating when in fact the data could not be retrieved (e.g., due to an outage, corrupted row, or malicious data manipulation). That trust score can then be used to make downstream business decisions that are unwarranted.  
**Fix:** Log the error and re‑throw it so that the failure surfaces to the caller, allowing proper error handling or fallback logic.

```diff
- try{

