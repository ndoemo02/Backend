import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    let cleared = { tts: false, stylize: false, sessions: false, nearby: false };
    try {
      const ttsMod = await import('../tts.js');
      if (ttsMod.clearTtsCaches) {
        ttsMod.clearTtsCaches();
        cleared.tts = true; cleared.stylize = true;
      }
    } catch {}
    try { if (global.sessionCache?.clear) { global.sessionCache.clear(); cleared.sessions = true; } } catch {}
    try { if (global.nearbyCache?.clear) { global.nearbyCache.clear(); cleared.nearby = true; } } catch {}

    console.log('[ADMIN] cache cleared', cleared);
    pushLog('admin', 'cache cleared');
    return res.status(200).json({ ok: true, cleared });
  } catch (e) {
    console.error('[ADMIN] cache clear error:', e.message);
    pushLog('error', `cache clear: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


