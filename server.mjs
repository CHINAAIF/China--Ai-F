/**
 * TRUNKIA Sovereign Bootstrap (Entry Point)
 * Activates Stream Interceptor BEFORE importing any other module.
 */
import { interceptStdout } from './lib/services/sovereign-logger.js';
interceptStdout();

// Dynamic import ensures all static imports inside index.js
// are executed AFTER the interceptor is active.
import('./index.js').catch(err => {
  process.stderr._origWrite(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'FATAL',
    msg: 'Bootstrap failed',
    error: { message: err.message, stack: err.stack }
  }) + '\n');
  process.exit(1);
});
