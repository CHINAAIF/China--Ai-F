/**
 * TRUNKIA Graceful Shutdown Handler
 * يمنع قطع transactions عند Railway restart
 */
export function setupGracefulShutdown(pool) {
  let shuttingDown = false;
  const handler = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[SHUTDOWN] ' + signal + ' received, draining...');
    const timer = setTimeout(() => { console.error('[SHUTDOWN] Force exit'); process.exit(1); }, 8000);
    try {
      if (pool && pool.end) await pool.end();
      console.log('[SHUTDOWN] Clean exit');
    } catch(e) { console.error('[SHUTDOWN] Error:', e.message); }
    clearTimeout(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}
