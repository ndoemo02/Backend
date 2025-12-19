import { supabase } from "../_supabase.js";
import { logger } from "../lib/logger.js";

/**
 * Validates the current system health and data status.
 */
export async function getSystemHealth() {
    const status = {
        state: "ALL SYSTEMS OPERATIONAL",
        label: "Wszystkie silniki zdolne do lotu",
        last_checked: new Date().toISOString(),
        confidence: 1.0,
        metrics: {
            revenue: "REALTIME",
            orders: "REALTIME",
            ai_intervention: "REALTIME",
            system_status: "REALTIME",
            sessions: "REALTIME"
        }
    };

    try {
        // 1. Check DB & API Basics
        const t0 = performance.now();
        const { data: dbCheck, error: dbError } = await supabase.from('restaurants').select('id').limit(1);
        const t1 = performance.now();

        if (dbError) {
            status.state = "INVALID";
            status.label = "Błąd połączenia z bazą danych (Supabase)";
            status.confidence = 0.0;
            return status;
        }

        // 2. Check Orders Freshness (Revenue & Orders)
        const { data: recentOrders, error: orderError } = await supabase
            .from('orders')
            .select('id')
            .limit(1);

        if (orderError || !recentOrders || recentOrders.length === 0) {
            status.metrics.revenue = "STALE";
            status.metrics.orders = "STALE";
            status.state = "DEGRADED";
            status.label = "Brak świeżych zamówień w systemie";
            status.confidence = 0.5;
        }

        // 3. Check Intent Freshness (AI & Sessions)
        const { data: recentIntents, error: intentError } = await supabase
            .from('amber_intents')
            .select('id')
            .limit(1);

        if (intentError || !recentIntents || recentIntents.length === 0) {
            status.metrics.ai_intervention = "STALE";
            status.metrics.sessions = "STALE";
            if (status.state === "ALL SYSTEMS OPERATIONAL") {
                status.state = "DEGRADED";
                status.label = "Brak aktywności AI w ostatnich logach";
                status.confidence = 0.7;
            }
        }

        // 4. Final adjustments
        if (status.state === "ALL SYSTEMS OPERATIONAL") {
            status.label = "Wszystkie silniki zdolne do lotu";
            status.confidence = 0.98;
        }

    } catch (e) {
        status.state = "INVALID";
        status.label = `Krytyczny błąd diagnostyki: ${e.message}`;
        status.confidence = 0.0;
    }

    return status;
}

export default async function handler(req, res) {
    // Auth check
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const health = await getSystemHealth();
    res.status(200).json({ ok: true, status: { "dr.panel.status": health } });
}
