/**
 * AI Tool: Stock/Availability Endpoint
 * GET /api/ai/tools/stock
 * 
 * Purpose: Check if specific menu items are in stock/available.
 * Used by AI Voice Agent before confirming orders.
 * 
 * Query Parameters:
 *   - item_id (required): UUID of the menu item
 *   - restaurant_id (optional): For batch queries
 *   - items (optional): Comma-separated list of item IDs for bulk check
 * 
 * Response (single):
 *   { ok: true, item_id, available: boolean, name, price }
 * 
 * Response (bulk):
 *   { ok: true, items: [{ item_id, available, name, price }] }
 */

import { supabase } from "../../_supabase.js";

export async function checkAvailability(itemIds, options = {}) {
    const { restaurantId } = options;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error("invalid_item_ids");
    }

    // UUID validation helper
    const isValidUUID = (id) => {
        if (!id) return false;
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    };

    const ids = itemIds.filter(isValidUUID);
    if (ids.length === 0) throw new Error("invalid_item_ids");

    const { data, error } = await supabase
        .from("menu_items_v2")
        .select("id, name, price_pln, available")
        .in("id", ids);

    if (error) {
        console.error("[AI/Stock] Bulk query error:", error.message);
        throw new Error("database_error");
    }

    // Map results, marking missing items as unavailable
    const results = ids.map(id => {
        const item = data?.find(i => i.id === id);
        return {
            item_id: id,
            available: item ? (item.available !== false) : false,
            name: item?.name || null,
            price: item ? parseFloat(item.price_pln) : null,
            found: !!item
        };
    });

    console.log(`[AI/Stock] Checked ${results.length} items: ${results.filter(r => r.available).length} available`);

    return {
        ok: true,
        items: results,
        total: ids.length,
        available_count: results.filter(r => r.available).length
    };
}

export default async function handler(req, res) {
    // Only allow GET
    if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const itemId = url.searchParams.get("item_id");
        const itemIds = url.searchParams.get("items"); // Comma-separated for bulk
        const restaurantId = url.searchParams.get("restaurant_id");

        let idsToCheck = [];

        // Determine IDs to check
        if (itemIds) {
            idsToCheck = itemIds.split(",").map(id => id.trim());
        } else if (itemId) {
            idsToCheck = [itemId];
        } else {
            return res.status(400).json({
                ok: false,
                error: "missing_item_id",
                hint: "Provide ?item_id=UUID or ?items=UUID1,UUID2"
            });
        }

        const result = await checkAvailability(idsToCheck, { restaurantId });

        // Maintain backward compatibility for single item query response format if needed,
        // but for now returning the unified bulk format is safer and cleaner for tools.
        // If the original single-item format is strictly required by frontend, we can adapt:
        if (itemId && !itemIds && result.items.length === 1) {
            const item = result.items[0];
            if (!item.found) {
                return res.status(404).json({
                    ok: false,
                    error: "item_not_found",
                    item_id: itemId,
                    available: false
                });
            }
            return res.status(200).json({
                ok: true,
                item_id: item.item_id,
                name: item.name,
                price: item.price,
                available: item.available,
                restaurant_id: null // Note: we didn't fetch restaurant_id in bulk query to save bw
            });
        }

        return res.status(200).json(result);

    } catch (err) {
        if (err.message === "invalid_item_ids") {
            return res.status(400).json({ ok: false, error: "invalid_item_ids" });
        }
        console.error("[AI/Stock] Error:", err.message);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: err.message
        });
    }
}
