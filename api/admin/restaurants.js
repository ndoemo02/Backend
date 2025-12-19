import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id,name,partner_mode,is_active,updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    // policz menu_count dla każdej restauracji (prosty N+1, wystarczy dla panelu)
    // Spróbuj wczytać średnie latencje z amber_intents (jeśli istnieje)
    let latByRest = {};
    try {
      const { data: latRows } = await supabase
        .from('amber_intents')
        .select('restaurant_id, duration_ms')
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .limit(5000);
      if (Array.isArray(latRows)) {
        const acc = {};
        for (const row of latRows) {
          if (!row?.restaurant_id) continue;
          const id = row.restaurant_id;
          const v = (typeof row.duration_ms === 'number') ? row.duration_ms : 0;
          const obj = acc[id] || (acc[id] = { s:0, n:0 });
          obj.s += v; obj.n += 1;
        }
        for (const [id,v] of Object.entries(acc)) latByRest[id] = Math.round(v.s / v.n);
      }
    } catch {}

    const out = [];
    for (const r of (restaurants || [])) {
      let menu_count = 0;
      try {
        const { count } = await supabase
          .from('menu_items_v2')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', r.id);
        menu_count = count || 0;
      } catch {}
      out.push({ id: r.id, name: r.name, partner_mode: r.partner_mode || 'none', is_active: !!r.is_active, updated_at: r.updated_at, menu_count, avgIntentLatency: latByRest[r.id] || 0 });
    }

    console.log('[ADMIN] /api/admin/restaurants', { returned: out.length });
    pushLog('admin', `restaurants list: ${out.length}`);
    return res.status(200).json({ ok: true, data: out });
  } catch (e) {
    console.error('[ADMIN] restaurants error:', e.message);
    pushLog('error', `restaurants: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


