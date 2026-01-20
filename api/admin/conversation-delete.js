import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Auth check
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });

    try {
        // 1. Delete events first (if not cascading)
        const { error: eventError } = await supabase
            .from('conversation_events')
            .delete()
            .eq('conversation_id', id);

        if (eventError) {
            console.warn(`⚠️ Error deleting events for conversation ${id}:`, eventError.message);
            // We continue to try deleting the conversation itself
        }

        // 2. Delete conversation
        const { error: convError } = await supabase
            .from('conversations')
            .delete()
            .eq('id', id);

        if (convError) {
            throw convError;
        }

        console.log(`🗑️ Admin: Conversation ${id} deleted.`);
        return res.json({ ok: true, message: 'Conversation deleted' });
    } catch (e) {
        console.error("Delete conversation error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
}
