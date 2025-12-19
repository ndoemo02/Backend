// api/freefun/list.js
import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const city = (req.query.city || '').toString();
    const nowIso = new Date().toISOString();
    let query = supabase
      .from('freefun_events')
      .select('id,title,description,date,city,location,link')
      .gte('date', nowIso)
      .order('date', { ascending: true })
      .limit(50);
    if (city) query = query.ilike('city', `%${city}%`);
    const { data, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, data: data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


