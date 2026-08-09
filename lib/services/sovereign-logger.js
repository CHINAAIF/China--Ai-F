/**
 * TRUNKIA Sovereign Logger v3.0 (Omega Protocol)
 * 
 * Complete Enterprise Rewrite:
 * 1. Stream-Level Interception (process.stdout/stderr, not console.log)
 * 2. Line Buffering (handles partial writes)
 * 3. Smart Pass-Through (zero overhead for already-JSON logs)
 * 4. Pattern Extraction ([ERROR], [CRON], etc.)
 * 5. Log Sampling (under high load)
 * 6. Ring Buffer (last 1000 logs for crash reports)
 * 7. Binary Detection (non-UTF8 safe)
 * 8. Signal Hot Reload (kill -USR1)
 * 9. Anti-Recursion Guard
 * 10. All Console Methods (log, error, warn, info, debug, table, dir)
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

const LOG_LEVELS = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };
let CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;

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
const RING_BUFFER_SIZE = 1000;
const SAMPLE_THRESHOLD = 100;
const SAMPLE_RATE = 0.1;

// Ring buffer for crash diagnostics
const ringBuffer = [];

// Log sampling counter
let logCounter = 0;
let lastSampleReset = Date.now();

// Anti-recursion guard
let isWriting = false;

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

function shouldLog(level) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return false;
  if (level === 'error' || level === 'fatal') return true;
  
  // Reset counter every second
  var now = Date.now();
  if (now - lastSampleReset > 1000) {
    logCounter = 0;
    lastSampleReset = now;
  }
  
  logCounter++;
  if (logCounter > SAMPLE_THRESHOLD) {
    return Math.random() < SAMPLE_RATE;
  }
  return true;
}

function addToRingBuffer(entry) {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
}

class SovereignLogger {
  _log(level, msg, meta, overrideStore) {
    if (!shouldLog(level)) return;

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
    addToRingBuffer(serialized);
    
    // Use original stdout/stderr (bypass interceptor)
    isWriting = true;
    try {
      if (level === 'error' || level === 'fatal') {
        process.stderr._origWrite(serialized + '\n');
      } else {
        process.stdout._origWrite(serialized + '\n');
      }
    } finally {
      isWriting = false;
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
          ip: req.headers['cf-connecting-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown'
        });
        res.on('finish', function() {
          var duration_ms = Date.now() - startTime;
          var level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          self._log(level, 'Request completed', {
            method: req.method, path: req.path, status: res.statusCode, duration_ms: duration_ms
          });
        });
        next();
      });
    };
  }

  withTrace(trace_id, user_id, module, fn) {
    return asyncLocalStorage.run({ trace_id: trace_id, user_id: user_id, module: module }, fn);
  }

  getContext() { return asyncLocalStorage.getStore() || {}; }

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

  getRingBuffer() { return ringBuffer.slice(); }
  flushRingBuffer() { var copy = ringBuffer.slice(); ringBuffer.length = 0; return copy; }
  setLevel(level) { CURRENT_LEVEL = LOG_LEVELS[level] ?? LOG_LEVELS.info; }
}

var loggerInstance = new SovereignLogger();

/**
 * STREAM-LEVEL INTERCEPTOR
 * Intercepts process.stdout.write and process.stderr.write.
 * Captures ALL output (console, libraries, native modules).
 * 
 * How it works:
 * 1. Buffer partial writes until \n
 * 2. If line starts with { and has "ts" → pass through (our logger)
 * 3. If line matches [LEVEL] pattern → extract level
 * 4. Wrap everything else in JSON envelope
 * 5. Anti-recursion: skip if isWriting flag is set
 */
export function interceptStdout() {
  var origStdoutWrite = process.stdout.write.bind(process.stdout);
  var origStderrWrite = process.stderr.write.bind(process.stderr);
  
  process.stdout._origWrite = origStdoutWrite;
  process.stderr._origWrite = origStderrWrite;
  
  var stdoutBuffer = '';
  var stderrBuffer = '';
  
  function isBinaryData(str) {
    for (var i = 0; i < Math.min(str.length, 100); i++) {
      var code = str.charCodeAt(i);
      if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return true;
    }
    return false;
  }
  
  function isOurJsonLog(line) {
    var trimmed = line.trim();
    if (trimmed.charAt(0) !== '{') return false;
    try {
      var obj = JSON.parse(trimmed);
      return obj.ts && obj.level && obj.msg !== undefined;
    } catch (e) { return false; }
  }
  
  function extractLevelAndModule(line) {
    var level = 'info';
    var module = 'legacy';
    var msg = line;
    
    // Pattern: [LEVEL] or [LEVEL:MODULE] message
    var match = line.match(/^\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)(?::([A-Z_]+))?\]\s*(.*)/i);
    if (match) {
      level = match[1].toLowerCase();
      if (level === 'warning') level = 'warn';
      if (level === 'critical') level = 'fatal';
      if (match[2]) module = match[2].toLowerCase();
      msg = match[3] || line;
    } else {
      // Pattern: [MODULE] message
      var modMatch = line.match(/^\[([A-Z_]{2,20})\]\s*(.*)/);
      if (modMatch) {
        module = modMatch[1].toLowerCase();
        msg = modMatch[2] || line;
      }
    }
    
    // Detect errors by keywords
    if (level === 'info' && /\b(error|fail|crash|fatal|exception|reject)\b/i.test(msg)) {
      level = 'error';
    }
    
    return { level: level, module: module, msg: msg.substring(0, MAX_STRING_LEN) };
  }
  
  function processLine(line, isError) {
    line = line.trim();
    if (line.length === 0) return null;
    
    // Pass through our own JSON logs
    if (isOurJsonLog(line)) return line;
    
    // Skip binary data
    if (isBinaryData(line)) return null;
    
    // Extract level and module from legacy patterns
    var extracted = extractLevelAndModule(line);
    if (isError && extracted.level === 'info') extracted.level = 'error';
    
    var store = asyncLocalStorage.getStore() || {};
    var entry = {
      ts: new Date().toISOString(),
      level: extracted.level.toUpperCase(),
      trace_id: store.trace_id || 'no-trace',
      user_id: store.user_id || 'system',
      module: extracted.module,
      msg: extracted.msg
    };
    
    return serialize(entry);
  }
  
  function createInterceptor(origWrite, buffer, isError) {
    return function(chunk, encoding, callback) {
      // Anti-recursion: if our logger is writing, bypass
      if (isWriting) {
        return origWrite(chunk, encoding, callback);
      }
      
      var str;
      if (Buffer.isBuffer(chunk)) {
        str = chunk.toString('utf8');
      } else if (typeof chunk === 'string') {
        str = chunk;
      } else {
        return origWrite(chunk, encoding, callback);
      }
      
      // Add to line buffer
      buffer += str;
      
      // Process complete lines
      var lines = buffer.split('\n');
      buffer = lines.pop(); // Keep last incomplete line in buffer
      
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.length === 0) continue;
        var processed = processLine(line, isError);
        if (processed) {
          isWriting = true;
          try {
            origWrite(processed + '\n');
          } finally {
            isWriting = false;
          }
        }
      }
      
      if (typeof callback === 'function') callback();
      return true;
    };
  }
  
  process.stdout.write = createInterceptor(origStdoutWrite, stdoutBuffer, false);
  process.stderr.write = createInterceptor(origStderrWrite, stderrBuffer, true);
  
  // Also intercept all console methods (they call process.stdout.write internally,
  // but some libraries check for console specifically)
  var origConsoleLog = console.log;
  var origConsoleErr = console.error;
  var origConsoleWarn = console.warn;
  var origConsoleInfo = console.info;
  var origConsoleDebug = console.debug;
  var origConsoleTable = console.table;
  var origConsoleDir = console.dir;
  
  // Console methods just route to stdout/stderr which is already intercepted.
  // But we override them to prevent any edge cases with libraries that
  // cache console references.
  console.log = function() { origConsoleLog.apply(console, arguments); };
  console.error = function() { origConsoleErr.apply(console, arguments); };
  console.warn = function() { origConsoleWarn.apply(console, arguments); };
  console.info = function() { origConsoleInfo.apply(console, arguments); };
  console.debug = function() { origConsoleDebug.apply(console, arguments); };
  console.table = function() { origConsoleTable.apply(console, arguments); };
  console.dir = function() { origConsoleDir.apply(console, arguments); };
  
  // Signal hot reload: kill -USR1 <pid> toggles debug mode
  process.on('SIGUSR1', function() {
    var newLevel = CURRENT_LEVEL <= LOG_LEVELS.info ? 'debug' : 'info';
    loggerInstance.setLevel(newLevel);
    loggerInstance.info('Log level changed via SIGUSR1', { new_level: newLevel });
  });
  
  // Crash report: on uncaught exception, dump ring buffer
  process.on('uncaughtException', function(err) {
    var crashReport = {
      ts: new Date().toISOString(),
      level: 'FATAL',
      trace_id: 'crash-report',
      msg: 'Uncaught Exception - Dumping Ring Buffer',
      error: { message: err.message, stack: err.stack ? err.stack.split('\n').slice(0, 10).join('\n') : '' },
      ring_buffer: loggerInstance.getRingBuffer()
    };
    origStderrWrite(serialize(crashReport) + '\n');
  });
  
  loggerInstance.info('Stream interceptor activated', { 
    level: process.env.LOG_LEVEL || 'info',
    sampling: 'enabled',
    ring_buffer: RING_BUFFER_SIZE
  });
}

export { loggerInstance as logger };
export default loggerInstance;
