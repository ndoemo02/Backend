import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
  if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      const restaurantId = url.searchParams.get('restaurant_id');
      if (!restaurantId) return res.status(400).json({ ok: false, error: 'missing_restaurant_id' });
      const { data, error } = await supabase
        .from('menu_items_v2')
        .select('id,name,price_pln,category,available')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      const mapped = (data || []).map(r => ({ id: r.id, name: r.name, price: r.price_pln, category: r.category, available: !!r.available }));
      console.log('[ADMIN] /api/admin/menu GET', { restaurantId, returned: mapped.length });
      pushLog('admin', `menu get for ${restaurantId} -> ${mapped.length}`);
      return res.status(200).json({ ok: true, data: mapped });
    }

    if (req.method === 'POST') {
      const body = (await req.json?.()) || req.body || {};
      const item = body || {};
      if (!item.restaurant_id || !item.name) {
        return res.status(400).json({ ok: false, error: 'missing_fields' });
      }
      const payload = {
        id: item.id || undefined,
        restaurant_id: item.restaurant_id,
        name: item.name,
        price_pln: Number(item.price) || 0,
        category: item.category || null,
        available: item.available !== false,
      };
      const { data, error } = await supabase
        .from('menu_items_v2')
        .upsert(payload)
        .select('id,restaurant_id,name,price_pln,category,available')
        .limit(1);
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const mapped = { id: row.id, restaurant_id: row.restaurant_id, name: row.name, price: row.price_pln, category: row.category, available: !!row.available };
      console.log('[ADMIN] /api/admin/menu POST', { restaurant_id: mapped.restaurant_id, id: mapped.id });
      pushLog('admin', `menu upsert ${mapped.id || 'new'} for ${mapped.restaurant_id}`);
      return res.status(200).json({ ok: true, data: mapped });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    console.error('[ADMIN] menu error:', e.message);
    pushLog('error', `menu: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


