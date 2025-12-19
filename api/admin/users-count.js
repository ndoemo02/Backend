import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) {
  return res.status(403).json({ ok: false, error: "forbidden" });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count: totalCount, error: err1 } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (err1) throw err1;

    const { count: activeCount, error: err2 } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('last_login', since);
    if (err2) throw err2;

    const data = { total: totalCount || 0, active24h: activeCount || 0, timestamp: new Date().toISOString() };
    console.log('[ADMIN] /api/admin/users-count', data);
    pushLog('admin', 'users-count queried');
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    console.error('[ADMIN] users-count error:', e.message);
    pushLog('error', `users-count: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


