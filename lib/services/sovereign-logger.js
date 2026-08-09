/**
 * TRUNKIA Sovereign Logger v2.0 (Omega Protocol)
 * 
 * Complete Rewrite:
 * 1. Deep Recursive Redaction (depth=10, array-aware)
 * 2. Non-Blocking I/O (process.stdout.write)
 * 3. Log Level Hierarchy (TRACE < DEBUG < INFO < WARN < ERROR < FATAL)
 * 4. Child Loggers (module tagging)
 * 5. Request Lifecycle (duration_ms + status_code)
 * 6. Error Stack Extraction (5 lines max)
 * 7. Size Guard (10KB max per log)
 * 8. Performance Timer
 * 9. Non-HTTP Trace Context (for Cron jobs)
 * 10. Circular Reference Protection (WeakSet + array check)
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

const LOG_LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };
const CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'apikey', 'api_key', 'secret', 'authorization',
  'cookie', 'groq_api_key', 'database_url', 'redis_url', 'private_key',
  'access_token', 'refresh_token', 'bearer', 'credential', 'immunesecret',
  'admin_secret', 'postgres_password', 'redis_password'
]);

const asyncLocalStorage = new AsyncLocalStorage();
const MAX_LOG_SIZE = 10240;
const MAX_DEPTH = 10;
const MAX_STRING_LEN = 500;
const MAX_STACK_LINES = 5;

function redact(obj, depth) {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.length > MAX_STRING_LEN ? obj.substring(0, MAX_STRING_LEN) + '...[TRUNCATED]' : obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (obj instanceof Error) {
    return { message: obj.message, stack: obj.stack ? obj.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : '' };
  }
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'function') return '[FUNCTION]';
  if (typeof obj !== 'object') return String(obj);

  if (Array.isArray(obj)) {
    return obj.slice(0, 100).map(function(item) { return redact(item, depth + 1); });
  }

  var result = {};
  var keys = Object.keys(obj).slice(0, 100);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redact(obj[key], depth + 1);
    }
  }
  return result;
}

function serialize(obj) {
  var seen = new WeakSet();
  var result;
  try {
    result = JSON.stringify(obj, function(key, value) {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);
      }
      return value;
    });
  } catch (e) {
    result = JSON.stringify({ error: 'SERIALIZATION_FAILED', message: e.message });
  }
  if (result.length > MAX_LOG_SIZE) {
    result = result.substring(0, MAX_LOG_SIZE) + '...[LOG_TRUNCATED]';
  }
  return result;
}

class SovereignLogger {
  _log(level, msg, meta, overrideStore) {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

    var store = overrideStore || asyncLocalStorage.getStore() || {};
    var entry = {
      ts: new Date().toISOString(),
      level: level.toUpperCase(),
      trace_id: store.trace_id || 'no-trace',
      user_id: store.user_id || 'system',
      module: store.module || 'core',
      msg: typeof msg === 'string' ? msg : String(msg)
    };

    if (meta !== undefined && meta !== null) {
      if (meta instanceof Error) {
        entry.error = { message: meta.message, stack: meta.stack ? meta.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : '' };
      } else if (typeof meta === 'object') {
        var redacted = redact(meta, 0);
        var keys = Object.keys(redacted);
        for (var i = 0; i < keys.length; i++) {
          entry[keys[i]] = redacted[keys[i]];
        }
      } else {
        entry.detail = String(meta);
      }
    }

    var serialized = serialize(entry);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }
  }

  trace(msg, meta) { this._log('trace', msg, meta); }
  debug(msg, meta) { this._log('debug', msg, meta); }
  info(msg, meta) { this._log('info', msg, meta); }
  warn(msg, meta) { this._log('warn', msg, meta); }
  error(msg, meta) { this._log('error', msg, meta); }
  fatal(msg, meta) { this._log('fatal', msg, meta); }

  child(options) {
    var parentStore = asyncLocalStorage.getStore() || {};
    var childStore = {};
    for (var k in parentStore) childStore[k] = parentStore[k];
    if (options) for (var k2 in options) childStore[k2] = options[k2];

    var self = this;
    return {
      trace: function(m, meta) { self._log('trace', m, meta, childStore); },
      debug: function(m, meta) { self._log('debug', m, meta, childStore); },
      info: function(m, meta) { self._log('info', m, meta, childStore); },
      warn: function(m, meta) { self._log('warn', m, meta, childStore); },
      error: function(m, meta) { self._log('error', m, meta, childStore); },
      fatal: function(m, meta) { self._log('fatal', m, meta, childStore); }
    };
  }

  middleware() {
    var self = this;
    return function(req, res, next) {
      var trace_id = req.headers['x-request-id'] || crypto.randomUUID();
      var user_id = (req.authResult && req.authResult.userId) || req.headers['x-user-id'] || 'anonymous';

      res.setHeader('x-request-id', trace_id);

      var startTime = Date.now();

      asyncLocalStorage.run({ trace_id: trace_id, user_id: user_id, module: 'API' }, function() {
        self.info('Request started', {
          method: req.method,
          path: req.path,
          ip: req.headers['cf-connecting-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown',
          user_agent: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 100) : 'unknown'
        });

        res.on('finish', function() {
          var duration_ms = Date.now() - startTime;
          var level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          self._log(level, 'Request completed', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration_ms: duration_ms,
            response_size: res.getHeader('content-length') || 0
          });
        });

        next();
      });
    };
  }

  withTrace(trace_id, user_id, module, fn) {
    return asyncLocalStorage.run({ trace_id: trace_id, user_id: user_id, module: module }, fn);
  }

  getContext() {
    return asyncLocalStorage.getStore() || {};
  }

  timer(label) {
    var self = this;
    var start = process.hrtime.bigint();
    return {
      end: function(meta) {
        var duration_ms = Number(process.hrtime.bigint() - start) / 1e6;
        var m = meta || {};
        m.duration_ms = Math.round(duration_ms);
        self.info(label, m);
        return duration_ms;
      }
    };
  }
}

var loggerInstance = new SovereignLogger();
export { loggerInstance as logger };
export default loggerInstance;
