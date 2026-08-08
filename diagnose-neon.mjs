import dns from 'dns';
import net from 'net';
import pg from 'pg';

const url = process.env.DATABASE_URL;
console.log("--- NEON CONNECTION DIAGNOSTICS ---\n");

// 1. Parse URL
const parsed = new URL(url);
const host = parsed.hostname;
const port = parseInt(parsed.port || '5432');
const db = parsed.pathname.slice(1);

console.log("1. URL Parsed:");
console.log("   Host:", host);
console.log("   Port:", port);
console.log("   DB:", db);
console.log("   User:", parsed.username);
console.log("   SSL Mode:", parsed.searchParams.get('sslmode') || 'not set');

// 2. DNS Resolution Test
console.log("\n2. DNS Resolution Test...");
try {
  const addresses = await dns.promises.lookup(host, { all: true });
  console.log("   ✅ DNS Resolved:", addresses.map(a => `${a.address} (${a.family})`).join(', '));
} catch (e) {
  console.log("   ❌ DNS Failed:", e.message);
  process.exit(1);
}

// 3. TCP Port Reachability Test
console.log(`\n3. TCP Port Test (${host}:${port})...`);
await new Promise((resolve) => {
  const socket = new net.Socket();
  socket.setTimeout(5000);
  socket.on('connect', () => {
    console.log(`   ✅ Port ${port} is OPEN and reachable.`);
    socket.destroy();
    resolve();
  });
  socket.on('timeout', () => {
    console.log(`   ❌ Port ${port} TIMED OUT. Carrier may be blocking it.`);
    socket.destroy();
    resolve();
  });
  socket.on('error', (e) => {
    console.log(`   ❌ Port ${port} ERROR:`, e.message);
    resolve();
  });
  socket.connect(port, host);
});

// 4. Raw PG Connection Test (No wrappers)
console.log("\n4. Raw PostgreSQL Connection Test...");
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false }
});

client.on('error', (e) => {
  console.log("   Client Error Event:", e.message);
});

try {
  await client.connect();
  console.log("   ✅ PG Connection Successful!");
  const res = await client.query('SELECT version()');
  console.log("   Version:", res.rows[0].version.substring(0, 50));
  await client.end();
} catch (e) {
  console.log("   ❌ PG Connection Failed:");
  console.log("   Error Code:", e.code);
  console.log("   Error Message:", e.message);
  if (e.stack) console.log("   Stack:", e.stack.split('\n')[0]);
}

console.log("\n--- DIAGNOSTICS COMPLETE ---");
process.exit(0);
