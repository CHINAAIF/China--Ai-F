import crypto from 'crypto';
import { pool } from './db.js';
const DB_TIMEOUT_MS=5000,NONCE_TTL_MS=300000,NONCE_MAX_SIZE=500000,MAX_QUEUE_SIZE=50000,MAX_WAITING_QUEUE=200,MERKLE_FLUSH_MS=30000,MERKLE_BUFFER_CAP=5000,KEY_ROTATION_MS=3600000,KEY_OVERLAP_MS=60000,MAX_EVENTS_PER_SESSION=1000,SESSION_WINDOW_MS=60000,CB_THRESHOLD=5,CB_RESET_MS=120000,MAX_RETRY_ATTEMPTS=3,BATCH_SIZE=100,MAX_POOL_CONNECTIONS=20,HEALTH_LOG_INTERVAL_MS=60000,NONCE_CLEANUP_MS=60000,REQUEST_MAX_AGE_MS=300000,SESSION_ID_MAX_LEN=128,DLQ_FLUSH_INTERVAL_MS=300000,DLQ_MAX_SIZE=10000;
const SESSION_ID_PATTERN=/^[a-zA-Z0-9_-]{1,128}$/;
const LOG_LEVELS={DEBUG:10,INFO:20,WARN:30,ERROR:40};
const CURRENT_LOG_LEVEL=LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()]??LOG_LEVELS.INFO;
const SENSITIVE_KEYS=new Set(['password','secret','token','key','authorization','signature','publickey','private','credential']);
function maskPayload(obj,depth=0){if(depth>3||obj===null||typeof obj!=='object')return obj;const r={};for(const[k,v]of Object.entries(obj)){if(SENSITIVE_KEYS.has(k.toLowerCase())){r[k]='[REDACTED]';}else if(typeof v==='object'){r[k]=maskPayload(v,depth+1);}else{r[k]=v;}}return r;}
class Logger{#c;constructor(c){this.#c=c;}#emit(level,msg,meta={}){if(LOG_LEVELS[level]<CURRENT_LOG_LEVEL)return;const e={ts:new Date().toISOString(),level,component:this.#c,msg,...maskPayload(meta)};(level==='ERROR'||level==='WARN'?process.stderr:process.stdout).write(JSON.stringify(e)+'
');}debug(m,x){this.#emit('DEBUG',m,x);}info(m,x){this.#emit('INFO',m,x);}warn(m,x){this.#emit('WARN',m,x);}error(m,x){this.#emit('ERROR',m,x);}}
class IntervalRegistry{#i=new Set();#t=new Set();register(h,isT=false){(isT?this.#t:this.#i).add(h);return h;}unregister(h){this.#i.delete(h);this.#t.delete(h);}clearAll(){for(const t of this.#t)clearTimeout(t);for(const i of this.#i)clearInterval(i);this.#t.clear();this.#i.clear();}}
const registry=new IntervalRegistry();
process.once('SIGTERM',()=>{registry.clearAll();process.exit(0);});
process.once('SIGINT',()=>{registry.clearAll();process.exit(0);});

class PoolSemaphore{#a;#w=[];#mw;constructor(max=MAX_POOL_CONNECTIONS,mw=MAX_WAITING_QUEUE){this.#a=max;this.#mw=mw;}acquire(){return new Promise((res,rej)=>{if(this.#a>0){this.#a--;return res();}if(this.#w.length>=this.#mw)return rej(new Error('SEMAPHORE_QUEUE_FULL'));const t=setTimeout(()=>{const i=this.#w.findIndex(q=>q.reject===rej);if(i!==-1)this.#w.splice(i,1);rej(new Error('SEMAPHORE_TIMEOUT'));},DB_TIMEOUT_MS);this.#w.push({resolve:()=>{clearTimeout(t);this.#a--;res();},reject:rej});});}release(){const n=this.#w.shift();if(n){n.resolve();}else{this.#a++;}}async withLock(fn){await this.acquire();try{return await fn();}finally{this.release();}}get waitingCount(){return this.#w.length;}}
const dbSemaphore=new PoolSemaphore();
class CircuitBreaker{#n;#f=0;#s='CLOSED';#lf=null;#p=false;#log;constructor(n){this.#n=n;this.#log=new Logger('CB:'+n);}isOpen(){if(this.#s==='CLOSED')return false;if(this.#s==='OPEN'){if(Date.now()-this.#lf>CB_RESET_MS){this.#s='HALF_OPEN';this.#p=false;return false;}return true;}if(this.#s==='HALF_OPEN'){if(this.#p)return true;this.#p=true;return false;}return false;}success(){this.#f=0;this.#s='CLOSED';this.#p=false;}failure(){this.#p=false;this.#f++;this.#lf=Date.now();if(this.#s==='HALF_OPEN'||this.#f>=CB_THRESHOLD){this.#s='OPEN';this.#log.error('OPEN',{failures:this.#f});}}get state(){return this.#s;}}

export const sovereignGateway=new SovereignGateway();
export{SovereignGateway,SovereignCryptoVault,NonceVault,SovereignEventBus,CircuitBreaker,DeadLetterQueue,PoolSemaphore,TrustedKeyRegistry,Logger};
