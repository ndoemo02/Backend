// Lightweight in-memory logger for admin/logs endpoint

if (!globalThis.__freeflow_logs) {
  globalThis.__freeflow_logs = [];
}

export function pushLog(level = 'info', message = '') {
  try {
    const entry = { time: new Date().toISOString(), level, message: String(message) };
    globalThis.__freeflow_logs.push(entry);
    // cap to 1000 entries in memory
    if (globalThis.__freeflow_logs.length > 1000) {
      globalThis.__freeflow_logs.splice(0, globalThis.__freeflow_logs.length - 1000);
    }
  } catch {}
}

export function getLastLogs(limit = 50) {
  const arr = globalThis.__freeflow_logs || [];
  return arr.slice(Math.max(0, arr.length - limit));
}


