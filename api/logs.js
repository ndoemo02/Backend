import { getLastLogs, pushLog } from "./utils/logger.js";

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (token && token === process.env.ADMIN_TOKEN) {
      const url = new URL(req.url, 'http://localhost');
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
      const logs = getLastLogs(limit);
      console.log('[ADMIN] /api/logs fetch', { limit, returned: logs.length });
      return res.status(200).json({ ok: true, logs });
    }
    // Brak tokenu admina — dopuść anonimowo minimalny wgląd? Specyfikacja wymaga 403 → zwracamy 403.
    return res.status(403).json({ ok: false, error: 'forbidden' });
  } catch (e) {
    pushLog('error', `logs: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


