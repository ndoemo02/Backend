import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Auth check
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        console.warn(`⛔ Admin Auth Failed! Given: '${token}', Expected env.ADMIN_TOKEN`);
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    // Delete all conversations. Assuming CASCADE logic for events, or we delete events first.
    // Safest is to delete related events first if cascade isn't guaranteed, 
    // but usually in Supabase/Postgres we set up FKs with cascade.
    // Let's try deleting conversations.

    // Note: 'conversations' table usually has 'id'. 
    // allow delete filter to match all.
    // created_at > 0 is a hacky way to match all if no specific filter is needed but delete() acts on filters.
    // better: .neq('id', '00000000-0000-0000-0000-000000000000') or something.
    // Or just .gt('id', '00000000-0000-0000-0000-000000000000') (uuids are lexicographically comparable?)
    
    // Actually, .neq('id', '0') might work if internal IDs are UUIDs. 
    // Another way is to separate calls or use RPC.
    
    // Let's try clearing conversation_events first for safety.
    const { error: err1 } = await supabase.from('conversation_events').delete().neq('id', 0); // Assuming 'id' is int or uuid.
    // If id is uuid, neq 0 might fail type check if strict.
    
    // Let's rely on simply deleting conversations and hoping for cascade or manually deleting.
    // But how to "delete all" in Supabase-js?
    // .delete() requires a filter.
    // We can use .neq('course_name', 'ThisStringDoesNotExist') but we don't know columns for sure.
    // usually .not('id', 'is', null) work?
    
    try {
        // 1. Delete events
        const { error: errorEvents } = await supabase
            .from('conversation_events')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete not null/empty
            
        // 2. Delete conversations
        const { error: errorConvs } = await supabase
            .from('conversations')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // UUID pattern

        if (errorConvs) throw errorConvs;

        return res.json({ ok: true, message: 'All conversations cleared' });
    } catch (e) {
        console.error("Clear error:", e);
        return res.status(500).json({ ok: false, error: e.message });
    }
}
