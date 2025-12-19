
import { supabase } from '../_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        // Query params
        const { from, to, fallbackOnly, limit = 50, restaurantId } = req.query;

        const limitVal = Math.min(Math.max(Number(limit) || 50, 1), 200);

        let query = supabase
            .from('brain_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limitVal);

        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to);
        if (fallbackOnly === 'true') query = query.eq('is_fallback', true);
        if (restaurantId) query = query.eq('restaurant_id', restaurantId);

        const { data, error } = await query;

        if (error) {
            console.error('❌ brain-logs fetch error:', error.message);
            throw error;
        }

        return res.status(200).json({ ok: true, data: data || [] });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
