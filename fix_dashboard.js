import fs from 'fs';
var p = '/data/data/com.termux/files/home/downloads/China--Ai-F/index.js';
var c = fs.readFileSync(p, 'utf8');

// Fix dashboard response - hide agent names
c = c.replace('recent_activity: activity.rows', 'recent_activity_count: activity.rows.length');
c = c.replace('sovereign: { operations: ops.rows },', 'sovereign: { operations_count: ops.rows[0]?.ops || 0 },');
c = c.replace('diagnostics: { repairs: repairs.rows },', 'diagnostics: { repairs_count: repairs.rows[0]?.count || 0 },');
c = c.replace('tasks: { queue: tasks.rows },', 'tasks: { queue_count: tasks.rows[0]?.count || 0 },');

// Fix error exposure in dashboard catch
c = c.replace("res.status(500).json({ error: e.message });\n  } catch(e) { res.status(500).json({ error: 'internal_error' });", 
  "res.status(500).json({ error: 'internal_error' });\n  } catch(e) { res.status(500).json({ error: 'internal_error' });");

// Fix error exposure in supervision catch
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message }); }\n\n// ── Judicial Stats",
  "} catch(e) { res.status(500).json({ error: 'internal_error' }); }\n\n// ── Judicial Stats"
);

// Fix error exposure in judicial catch
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message }); }\n\n// ── Redundancy",
  "} catch(e) { res.status(500).json({ error: 'internal_error' }); }\n\n// ── Redundancy"
);

// Fix error exposure in redundancy catch
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message }); }\n\n// ── Performance",
  "} catch(e) { res.status(500).json({ error: 'internal_error' }); }\n\n// ── Performance"
);

// Fix error exposure in performance catch
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message }); }\n\n// ── 404",
  "} catch(e) { res.status(500).json({ error: 'internal_error' }); }\n\n// ── 404"
);

// Fix error exposure in 404 catch
c = c.replace(
  "} catch(e) { res.status(500).json({ error: e.message, request_id: req.requestId });\n\n// ── Error Handler",
  "} catch(e) { res.status(500).json({ error: 'internal_error', request_id: req.requestId });\n\n// ── Error Handler"
);

// Fix error exposure in error handler catch
c = c.replace(
  "console.error('Unhandled:', err.message);\n  res.status(500).json({ error: 'internal_error', request_id: req.requestId });",
  "console.error('Unhandled:', err.code || err.message);\n  res.status(500).json({ error: 'internal_error', request_id: req.requestId });"
);

fs.writeFileSync(p, c, 'utf8');
console.log('OK: all error exposures and agent names hidden');
