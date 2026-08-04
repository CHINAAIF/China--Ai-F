import Redis from 'ioredis';
import crypto from 'crypto';

const redisUrl = process.env.REDIS_URL;
let client = null;
let pubSub = null;

const localMemory = new Map();
const localSubscribers = new Map();

if (redisUrl) {
  console.log('[Blackboard] Connecting to Redis for Distributed Memory...');
  client = new Redis(redisUrl);
  pubSub = new Redis(redisUrl);
} else {
  console.log('[Blackboard] INFO: REDIS_URL not set. Using local memory (Development mode).');
}

const IMMUNE_SECRET = process.env.IMMUNE_SECRET;
if (!IMMUNE_SECRET) throw new Error('CRITICAL: IMMUNE_SECRET is not set. Blackboard cannot verify identities.');

const SYSTEM_AUTHORS = new Set(['self_healer', 'fault_detector', 'cognitive_drift', 'phoenix', 'orchestrator', 'system']);

// Helper to generate expected token
function _generateToken(name) {
  return crypto.createHmac('sha256', IMMUNE_SECRET).update(name).digest('hex');
}

function verifyAuthor(key, authorToken) {
  if (!authorToken) throw new Error('[BLACKBOARD] REJECTED: Missing author token.');
  
  let expectedName = null;

  // Extract expected name from key
  if (key.startsWith('agent:')) {
    const parts = key.split(':');
    if (parts.length > 1) expectedName = parts[1];
  } else if (key.startsWith('system:')) {
    // System keys require a system token
    // We check if token matches ANY system author
    const isSystem = [...SYSTEM_AUTHORS].some(name => _generateToken(name) === authorToken);
    if (!isSystem) throw new Error(`[BLACKBOARD] REJECTED: Invalid system token for ${key}.`);
    return true;
  } else if (key.startsWith('session:')) {
    expectedName = 'orchestrator'; // Only orchestrator can write sessions
  } else {
    return true; // Unrestricted keys (if any)
  }

  if (expectedName) {
    const expectedToken = _generateToken(expectedName);
    if (expectedToken !== authorToken) {
      throw new Error(`[BLACKBOARD] REJECTED: Cryptographic identity verification failed for ${key}.`);
    }
  }
  
  return true;
}

export async function writeMemory(key, value, ttl = 3600, authorToken = null) {
  try {
    verifyAuthor(key, authorToken);
  } catch (e) {
    console.error(e.message);
    // Future: reportAnomaly to Immune System here
    return false;
  }

  const data = JSON.stringify({ value, timestamp: Date.now() });
  if (client) {
    await client.set(key, data, 'EX', ttl);
    await client.publish('blackboard_updates', key);
  } else {
    localMemory.set(key, data);
    if (localSubscribers.has('blackboard_updates')) {
      localSubscribers.get('blackboard_updates').forEach(cb => cb(key));
    }
  }
  return true;
}

export async function readMemory(key) {
  if (client) {
    const data = await client.get(key);
    return data ? JSON.parse(data).value : null;
  } else {
    const data = localMemory.get(key);
    return data ? JSON.parse(data).value : null;
  }
}

export function subscribeToUpdates(callback) {
  if (pubSub) {
    pubSub.subscribe('blackboard_updates');
    pubSub.on('message', (channel, key) => callback(key));
  } else {
    if (!localSubscribers.has('blackboard_updates')) {
      localSubscribers.set('blackboard_updates', []);
    }
    localSubscribers.get('blackboard_updates').push(callback);
  }
}

export async function flushMemory() {
  if (client) {
    await client.flushdb();
  } else {
    localMemory.clear();
  }
}

// Exposed for agents to generate their tokens at startup
export function generateMemoryToken(name) {
  return _generateToken(name);
}
