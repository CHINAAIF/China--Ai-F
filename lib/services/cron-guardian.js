import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_FAILURES = 5;
const MAX_HISTORY = 100;

class CronGuardian {
  constructor() {
    this.locks = new Map();
    this.stats = new Map();
    this.zombies = new Set();
    this.shutdownMode = false;
    this.runningCount = 0;
  }

  safeCron(name, fn, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxFailures = opts.maxFailures || DEFAULT_MAX_FAILURES;

    return async () => {
      if (this.shutdownMode) {
        console.warn('[CRON SKIP] ' + name + ' skipped (shutdown mode)');
        return;
      }

      let stat = this.stats.get(name);
      if (!stat) {
        stat = {
          runs: 0, failures: 0, consecutiveFailures: 0,
          lastRun: null, lastStatus: null,
          disabled: false, disabledAt: null,
          history: []
        };
        this.stats.set(name, stat);
      }

      if (stat.disabled) {
        return;
      }

      if (this.locks.has(name)) {
        console.warn('[CRON SKIP] ' + name + ' already running');
        this._record(name, stat, 'skipped', 0);
        return;
      }

      const runId = crypto.randomUUID();
      this.locks.set(name, { runId: runId, startTime: Date.now() });
      this.runningCount++;

      let timedOut = false;
      const timeoutId = setTimeout(() => {
        var lock = this.locks.get(name);
        if (lock && lock.runId === runId) {
          timedOut = true;
          this.locks.delete(name);
          this.zombies.add(runId);
          this.runningCount--;
          console.error('[CRON TIMEOUT] ' + name + ' exceeded ' + timeoutMs + 'ms. Lock forcefully released. Zombie tracked: ' + runId.substring(0, 8));
          this._record(name, stat, 'timeout', timeoutMs);
          stat.consecutiveFailures++;
          this._checkBreaker(name, stat, maxFailures);
        }
      }, timeoutMs);

      var start = Date.now();
      try {
        await fn();
        if (!timedOut) {
          clearTimeout(timeoutId);
          this._record(name, stat, 'success', Date.now() - start);
          stat.consecutiveFailures = 0;
        }
      } catch (e) {
        if (!timedOut) {
          clearTimeout(timeoutId);
          console.error('[CRON ERR] ' + name + ': ' + e.message);
          if (e.stack) console.error(e.stack.split('\n').slice(0, 3).join('\n'));
          this._record(name, stat, 'error', Date.now() - start, e.message);
          stat.consecutiveFailures++;
          this._checkBreaker(name, stat, maxFailures);
        }
      } finally {
        if (!timedOut) {
          var lock = this.locks.get(name);
          if (lock && lock.runId === runId) {
            this.locks.delete(name);
            this.runningCount--;
          }
        } else {
          this.zombies.delete(runId);
        }
      }
    };
  }

  _record(name, stat, status, elapsedMs, error) {
    stat.runs++;
    stat.lastRun = new Date().toISOString();
    stat.lastStatus = status;
    if (status === 'error' || status === 'timeout') {
      stat.failures++;
    }
    stat.history.push({
      status: status,
      elapsedMs: elapsedMs,
      error: error || null,
      ts: stat.lastRun
    });
    if (stat.history.length > MAX_HISTORY) {
      stat.history.shift();
    }
  }

  _checkBreaker(name, stat, maxFailures) {
    if (stat.consecutiveFailures >= maxFailures) {
      stat.disabled = true;
      stat.disabledAt = new Date().toISOString();
      console.error('[CRON BREAKER] ' + name + ' DISABLED after ' + stat.consecutiveFailures + ' consecutive failures. Use resetCronBreaker(\'' + name + '\') to re-enable.');
    }
  }

  getStats() {
    var result = {};
    for (var entry of this.stats) {
      var name = entry[0];
      var stat = entry[1];
      result[name] = {
        runs: stat.runs,
        failures: stat.failures,
        consecutiveFailures: stat.consecutiveFailures,
        lastRun: stat.lastRun,
        lastStatus: stat.lastStatus,
        disabled: stat.disabled,
        disabledAt: stat.disabledAt,
        activeZombies: 0,
        recentHistory: stat.history.slice(-5)
      };
    }
    return result;
  }

  async gracefulShutdown(maxWaitMs) {
    this.shutdownMode = true;
    var wait = maxWaitMs || 10000;
    console.log('[CRON GUARDIAN] Shutdown mode enabled. Waiting for ' + this.runningCount + ' running jobs (max ' + wait + 'ms)...');
    var start = Date.now();
    while (this.runningCount > 0 && Date.now() - start < wait) {
      await new Promise(function(r) { setTimeout(r, 200); });
    }
    if (this.runningCount > 0) {
      console.warn('[CRON GUARDIAN] ' + this.runningCount + ' jobs still running after ' + wait + 'ms. Forcing shutdown.');
    } else {
      console.log('[CRON GUARDIAN] All jobs completed. Safe to shutdown.');
    }
  }

  resetBreaker(name) {
    var stat = this.stats.get(name);
    if (stat) {
      stat.disabled = false;
      stat.consecutiveFailures = 0;
      stat.disabledAt = null;
      console.log('[CRON GUARDIAN] Circuit breaker reset for ' + name);
    }
  }
}

var guardian = new CronGuardian();

export function safeCron(name, fn, options) {
  return guardian.safeCron(name, fn, options);
}
export function getGuardianStats() {
  return guardian.getStats();
}
export function gracefulCronShutdown(maxWaitMs) {
  return guardian.gracefulShutdown(maxWaitMs);
}
export function resetCronBreaker(name) {
  guardian.resetBreaker(name);
}
export default { safeCron: safeCron, getGuardianStats: getGuardianStats, gracefulCronShutdown: gracefulCronShutdown, resetCronBreaker: resetCronBreaker };
