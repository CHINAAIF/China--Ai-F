import { loadAllAgents } from './agents/registry.js';
const result = await loadAllAgents();
if (Array.isArray(result)) console.log('Total:', result.length);
else if (result instanceof Map) console.log('Total:', result.size);
else console.log('Type:', typeof result, Object.keys(result||{}).length);
process.exit(0);
