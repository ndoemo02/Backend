import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const modes = ['full','lite','none'];
    const results = { full: 0, lite: 0, none: 0 };

    for (const m of modes) {
      const { count, error } = await supabase
        .from('restaurants')
        .select('id', { count: 'exact', head: true })
        .eq('partner_mode', m);
      if (error) throw error;
      results[m] = count || 0;
    }

    const data = { ...results, timestamp: new Date().toISOString() };
    console.log('[ADMIN] /api/admin/partners-count', data);
    pushLog('admin', 'partners-count queried');
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    console.error('[ADMIN] partners-count error:', e.message);
    pushLog('error', `partners-count: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


