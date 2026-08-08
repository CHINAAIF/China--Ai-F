import fs from 'fs';
const f = 'lib/db.js';
let c = fs.readFileSync(f, 'utf8');

// 1. Define Protected Tables and the Veto Function
const vetoLogic = `
// --- SOVEREIGN APPLICATION-LEVEL VETO ---
const PROTECTED_TABLES = ['immune_audit_chain', 'event_log', 'agent_execution_logs', 'governance_audit_chain', 'intel_provenance_chain', 'evidence_chain', 'immune_agent_trust', 'agent_behavioral_baselines', 'immune_anomaly_log', 'canary_token_registry'];

function enforceSovereignVeto(text) {
  if (!text || typeof text !== 'string') return;
  
  // Check if emergency override is active (Requires both env var and HMAC signature)
  const overrideSig = process.env.APP_EMERGENCY_OVERRIDE_SIG;
  const expectedSig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update('EMERGENCY_OVERRIDE').digest('hex');
  const isEmergencyActive = overrideSig === expectedSig;

  if (isEmergencyActive) return; // Allow if break-glass is explicitly activated

  const upperText = text.toUpperCase();
  for (const table of PROTECTED_TABLES) {
    const tableUpper = table.toUpperCase();
    // Detect UPDATE or DELETE on protected tables
    if ((upperText.includes('UPDATE ' + tableUpper) || upperText.includes('DELETE FROM ' + tableUpper)) && !upperText.includes('WHERE 1=0')) {
      throw new Error('SOVEREIGN VETO: Application-level block on protected table ' + table + '. Tampering is forbidden.');
    }
  }
}
// -----------------------------------------
`;

// Inject the Veto logic after the imports
if (!c.includes('SOVEREIGN APPLICATION-LEVEL VETO')) {
  c = c.replace("dns.setDefaultResultOrder('ipv4first');", "dns.setDefaultResultOrder('ipv4first');\n" + vetoLogic);
}

// Wrap the query function
const oldQuery = `export async function query(text, params) {
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();`;

const newQuery = `export async function query(text, params) {
  enforceSovereignVeto(text);
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();`;

if (c.includes(oldQuery)) {
  c = c.replace(oldQuery, newQuery);
}

// Wrap the withTransaction function to check queries inside it
const oldTx = `export async function withTransaction(fn) {
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();`;

const newTx = `export async function withTransaction(fn) {
  const start = Date.now();
  const pool = getPool('main', _internalToken);
  const client = await pool.connect();
  const wrappedClient = {
    query: async (text, params) => {
      enforceSovereignVeto(text);
      return client.query(text, params);
    }
  };`;

if (c.includes(oldTx)) {
  c = c.replace(oldTx, newTx);
  // Fix the function call inside the transaction to use the wrapped client
  c = c.replace("const result = await fn(client);", "const result = await fn(wrappedClient);");
}

fs.writeFileSync(f, c, 'utf8');
console.log('✅ Patched lib/db.js (Application-Level Sovereign Veto Injected)');
