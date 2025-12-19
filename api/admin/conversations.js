import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
    // Auth check
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        console.warn(`⛔ Admin Auth Failed! Given: '${token}', Expected env.ADMIN_TOKEN`);
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const limit = Math.min(parseInt(req.query.limit || '50'), 100);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    // 1. Pobierz rozmowy
    const { data: conversations, error: convError } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (convError) {
        console.error('❌ Error fetching conversations:', convError);
        return res.status(500).json({ ok: false, error: convError.message });
    }

    if (!conversations || conversations.length === 0) {
        return res.json({ ok: true, data: [] });
    }

    // 2. Pobierz eventy dla tych rozmów (do wyliczenia stage)
    const convIds = conversations.map(c => c.id);
    const { data: allEvents, error: eventsError } = await supabase
        .from('conversation_events')
        .select('conversation_id, workflow_step, event_status, created_at')
        .in('conversation_id', convIds);

    if (eventsError) {
        console.warn('⚠️ Error fetching events (falling back to simple stage check):', eventsError);
    }

    // 3. Post-processing: znajdź najwyższy etap dla każdej sesji
    const enrichedData = conversations.map(c => {
        let maxStep = 0;
        let lastStepName = '';

        // Mapowanie kroków na numery
        const steps = { 'find_nearby': 1, 'show_city_results': 1, 'show_menu': 2, 'create_order': 3, 'confirm_order': 4 };

        const events = (allEvents || []).filter(e => e.conversation_id === c.id);

        if (events.length > 0) {
            events.forEach(e => {
                const name = e.workflow_step;
                if (steps[name] && steps[name] > maxStep) {
                    maxStep = steps[name];
                    lastStepName = name;
                }
            });
        }

        // Heurystyka fallback (jeśli brak workflow_step w bazie, bo stare dane)
        if (maxStep === 0) {
            if (c.status === 'closed') maxStep = 4;
            else if (c.metadata?.pendingOrder) maxStep = 3;
            else if (c.metadata?.lastRestaurant) maxStep = 2;
            else maxStep = 1;
        }

        return {
            ...c,
            // Nie wysyłamy całej listy zdarzeń żeby nie zapchać łącza, tylko wyliczone
            calculated_stage: maxStep,
            calculated_step_name: lastStepName,
        };
    });

    return res.json({ ok: true, data: enrichedData });
}
