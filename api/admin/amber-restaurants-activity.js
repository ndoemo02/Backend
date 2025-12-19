// api/admin/amber-restaurants-activity.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.query.token || req.query.admin_token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const days = parseInt(req.query.days || '7', 10);
    const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    // fetch intents with restaurant_id
    const { data: intents, error } = await supabase
      .from('amber_intents')
      .select('restaurant_id, created_at')
      .gte('created_at', sinceIso)
      .limit(10000);
    if (error) throw error;

    const counts = new Map();
    (intents || []).forEach(r => {
      const id = r.restaurant_id || 'unknown';
      counts.set(id, (counts.get(id) || 0) + 1);
    });

    // join names
    const ids = Array.from(counts.keys()).filter(x => x !== 'unknown');
    let names = new Map();
    if (ids.length) {
      const { data: rests } = await supabase.from('restaurants').select('id,name').in('id', ids);
      (rests || []).forEach(r => names.set(r.id, r.name));
    }

    const list = Array.from(counts.entries())
      .map(([id, n]) => ({ id, name: id === 'unknown' ? '—' : (names.get(id) || id), interactions: n }))
      .sort((a,b)=> b.interactions - a.interactions)
      .slice(0, 20);

    return res.status(200).json({ ok: true, data: list, days });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}


