// api/admin/trends-alerts.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.query.token || req.query.admin_token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    try {
      const { data, error } = await supabase
        .from('amber_alerts')
        .select('created_at,type,severity,message,metric,delta_pct,value_now,value_prev,details')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && Array.isArray(data)) {
        return res.status(200).json({ ok: true, alerts: data });
      }
    } catch {}

    const mem = globalThis.__amber_alerts || [];
    return res.status(200).json({ ok: true, alerts: mem.slice().reverse().slice(-20) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


