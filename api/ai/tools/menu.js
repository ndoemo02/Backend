/**
 * AI Tool: Menu Endpoint
 * GET /api/ai/tools/menu
 * 
 * Purpose: Provides menu data for AI Voice Agent to assist with ordering.
 * Optimized for LLM consumption with simplified response format.
 * 
 * Query Parameters:
 *   - restaurant_id (required): UUID of the restaurant
 *   - limit (optional): Max items to return (default: 50)
 *   - include_unavailable (optional): Include out-of-stock items (default: false)
 * 
 * Response:
 *   { ok: true, items: [{ id, name, price, description, available, category }] }
 */

import { getMenuItems } from "../../brain/menuService.js";
import { supabase } from "../../_supabase.js";

export async function getMenu(restaurantId, options = {}) {
    const { limit = 50, includeUnavailable = false } = options;

    // Validate restaurant_id
    if (!restaurantId) throw new Error("missing_restaurant_id");

    // UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(restaurantId)) throw new Error("invalid_restaurant_id");

    // Verify restaurant exists
    const { data: restaurant, error: restError } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("id", restaurantId)
        .single();

    if (restError || !restaurant) throw new Error("restaurant_not_found");

    // Fetch menu items using existing service (with caching)
    const menuItems = await getMenuItems(restaurantId, {
        includeUnavailable,
        limit
    });

    // Transform to simplified AI-friendly format
    const items = menuItems.map(item => ({
        id: item.id,
        name: item.name,
        price: parseFloat(item.price_pln) || 0,
        description: item.description || null,
        category: item.category || null,
        available: item.available !== false
    }));

    return {
        ok: true,
        restaurant_id: restaurantId,
        restaurant_name: restaurant.name,
        items,
        count: items.length
    };
}

export default async function handler(req, res) {
    // Only allow GET
    if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const restaurantId = url.searchParams.get("restaurant_id");
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const includeUnavailable = url.searchParams.get("include_unavailable") === "true";

        const result = await getMenu(restaurantId, { limit, includeUnavailable });
        return res.status(200).json(result);

    } catch (err) {
        // Handle known errors with 400/404
        if (["missing_restaurant_id", "invalid_restaurant_id"].includes(err.message)) {
            return res.status(400).json({ ok: false, error: err.message });
        }
        if (err.message === "restaurant_not_found") {
            return res.status(404).json({ ok: false, error: err.message });
        }

        console.error("[AI/Menu] Error:", err.message);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: err.message
        });
    }
}
