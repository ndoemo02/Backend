// api/admin/business-stats.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.query.token || req.query.admin_token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const days = parseInt(req.query.days || '7', 10);
    const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    // Try RPC get_business_stats
    try {
      const { data, error } = await supabase.rpc('get_business_stats');
      if (!error && data) {
        // add interactions & conversion
        const { data: intents } = await supabase
          .from('amber_intents')
          .select('id')
          .gte('created_at', sinceIso);
        const interactions = Array.isArray(intents) ? intents.length : 0;
        const conversion = interactions > 0 ? (Number(data.total_orders || 0) / interactions) : 0;
        return res.status(200).json({ ok: true, days, total_orders: data.total_orders || 0, total_revenue: Number(data.total_revenue || 0), avg_order: Number(data.avg_order || 0), interactions, conversion });
      }
    } catch {}

    // Fallback aggregations
    let totalOrders = 0;
    let totalRevenue = 0;
    let avgOrder = 0;
    try {
      const { data: ordRows } = await supabase
        .from('orders')
        .select('total_price,total_cents,created_at')
        .gte('created_at', sinceIso);
      const val = (o) => (typeof o.total_price === 'number') ? o.total_price : ((o.total_cents || 0) / 100);
      const vals = (ordRows || []).map(val);
      totalOrders = vals.length;
      totalRevenue = vals.reduce((a,b)=>a+b,0);
      avgOrder = totalOrders ? (totalRevenue / totalOrders) : 0;
    } catch {}

    let interactions = 0;
    try {
      const { data: intents } = await supabase
        .from('amber_intents')
        .select('id')
        .gte('created_at', sinceIso);
      interactions = Array.isArray(intents) ? intents.length : 0;
    } catch {}
    const conversion = interactions > 0 ? (totalOrders / interactions) : 0;
    return res.status(200).json({ ok: true, days, total_orders: totalOrders, total_revenue: Number(totalRevenue.toFixed(2)), avg_order: Number(avgOrder.toFixed(2)), interactions, conversion });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


