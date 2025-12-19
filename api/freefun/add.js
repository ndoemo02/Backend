// api/freefun/add.js
import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    // token is enforced by route using verifyAmberAdmin middleware; fallback check here too
    const token = req.headers['x-admin-token'] || req.query.admin_token || req.query.token;
    if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const { title, description, date, city, location, link } = req.body || {};
    if (!title || !date || !city) return res.status(400).json({ ok: false, error: 'missing_fields' });
    const { error } = await supabase.from('freefun_events').insert({ title, description, date, city, location, link });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


