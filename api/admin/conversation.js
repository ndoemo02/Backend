import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
    // Auth check
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    // 1. Pobierz rozmowę
    const { data: conv, error: e1 } = await supabase.from('conversations').select('*').eq('id', id).single();

    if (e1 || !conv) {
        return res.status(404).json({ ok: false, error: 'not_found', details: e1?.message });
    }

    // 2. Pobierz timeline eventów
    const { data: events, error: e2 } = await supabase
        .from('conversation_events')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });

    return res.json({
        ok: true,
        data: {
            ...conv,
            timeline: events || []
        }
    });
}
