import pg from 'pg';

console.log("--- NEON SSL Handshake Diagnostics ---");
console.log("System Time:", new Date().toISOString());

const url = process.env.DATABASE_URL;

console.log("\n1. Attempting Raw Connection (URL only)...");
try {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log("✅ RAW CONNECTION SUCCESS!");
  await client.end();
  process.exit(0);
} catch (e) {
  console.log("❌ Raw Failed:", e.message);
}

console.log("\n2. Attempting Connection with Explicit SSL...");
try {
  const client = new pg.Client({ 
    connectionString: url, 
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
  });
  await client.connect();
  console.log("✅ EXPLICIT SSL CONNECTION SUCCESS!");
  await client.end();
  process.exit(0);
} catch (e) {
  console.log("❌ Explicit SSL Failed:", e.message);
}

console.log("\n3. Attempting Connection with Neon Endpoint Helper...");
// Sometimes Neon requires specific SNI
try {
  const parsed = new URL(url);
  const client = new pg.Client({
    host: parsed.hostname,
    port: parsed.port || 5432,
    database: parsed.pathname.slice(1),
    user: parsed.username,
    password: parsed.password,
    ssl: true,
    connectionTimeoutMillis: 15000
  });
  await client.connect();
  console.log("✅ HELPER CONNECTION SUCCESS!");
  await client.end();
  process.exit(0);
} catch (e) {
  console.log("❌ Helper Failed:", e.message);
}

process.exit(1);
