/**
 * AI Tool: Order Creation Endpoint
 * POST /api/ai/tools/order
 * 
 * Purpose: Creates orders on behalf of users via AI Voice Agent.
 * Wraps existing order logic with AI-specific validation and response format.
 * 
 * Request Body:
 *   {
 *     restaurant_id: UUID (required),
 *     items: [{ id: UUID, quantity: number, mods?: string[] }] (required),
 *     table_id?: string,
 *     customer_name?: string,
 *     customer_phone?: string,
 *     delivery_address?: string,
 *     notes?: string,
 *     source?: "voice" | "chat" | "api"
 *   }
 * 
 * Response:
 *   { ok: true, order_id, status, total, items_count, restaurant_name }
 */

import { supabase } from "../../_supabase.js";
import { getMenuItems, sumCartItems } from "../../brain/menuService.js";

export async function createOrder(orderData) {
    const {
        restaurant_id,
        items,
        table_id,
        customer_name,
        customer_phone,
        delivery_address,
        notes,
        source = "voice"
    } = orderData;

    // === VALIDATION ===

    // 1. Restaurant ID required
    if (!restaurant_id) throw new Error("missing_restaurant_id");

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(restaurant_id)) throw new Error("invalid_restaurant_id");

    // 2. Items required and must be array
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error("missing_items");
    }

    // 3. Validate each item
    for (const item of items) {
        if (!item.id) throw new Error("item_missing_id");
        if (!uuidRegex.test(item.id)) throw new Error(`invalid_item_id:${item.id}`);
    }

    // === VERIFY RESTAURANT EXISTS ===
    const { data: restaurant, error: restError } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("id", restaurant_id)
        .single();

    if (restError || !restaurant) throw new Error("restaurant_not_found");

    // === VERIFY ITEMS EXIST AND GET PRICES ===
    const menuItems = await getMenuItems(restaurant_id, { includeUnavailable: true });
    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    const enrichedItems = [];
    const unavailableItems = [];

    for (const orderItem of items) {
        const menuItem = menuMap.get(orderItem.id);

        if (!menuItem) {
            const err = new Error("item_not_found");
            err.item_id = orderItem.id;
            throw err;
        }

        // Check availability
        if (menuItem.available === false) {
            unavailableItems.push({
                id: menuItem.id,
                name: menuItem.name
            });
        }

        const quantity = Math.max(1, parseInt(orderItem.quantity, 10) || 1);
        const price = parseFloat(menuItem.price_pln) || 0;

        enrichedItems.push({
            menu_item_id: menuItem.id,
            name: menuItem.name,
            quantity,
            unit_price_pln: price,
            total_pln: price * quantity,
            mods: orderItem.mods || []
        });
    }

    // Warn about unavailable items but still allow order
    if (unavailableItems.length > 0) {
        console.warn(`[AI/Order] Warning: ${unavailableItems.length} items are marked unavailable:`, unavailableItems);
    }

    // === CALCULATE TOTAL ===
    const totalPln = enrichedItems.reduce((sum, item) => sum + item.total_pln, 0);

    // === CREATE ORDER IN DATABASE ===
    const dbOrderData = {
        restaurant_id,
        restaurant_name: restaurant.name,
        user_id: null, // AI orders are anonymous unless auth is added
        items: enrichedItems.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.unit_price_pln,
            menu_item_id: item.menu_item_id,
            mods: item.mods
        })),
        total_price: totalPln,
        status: "pending",
        source: source,
        table_id: table_id || null,
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        delivery_address: delivery_address || null,
        notes: notes || null,
        created_at: new Date().toISOString()
    };

    const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert([dbOrderData])
        .select("id, status, created_at")
        .single();

    if (orderError) {
        console.error("[AI/Order] Insert error FULL:", JSON.stringify(orderError, null, 2));
        import('fs').then(fs => fs.writeFileSync('error_log.txt', JSON.stringify(orderError, null, 2)));
        throw new Error(`order_creation_failed: ${orderError.message}`);
    }

    console.log(`[AI/Order] Created order ${order.id} for ${restaurant.name} | Total: ${totalPln.toFixed(2)} PLN`);

    // === SUCCESS RESPONSE ===
    return {
        ok: true,
        order_id: order.id,
        status: order.status,
        total: totalPln,
        total_formatted: `${totalPln.toFixed(2)} zł`,
        items_count: enrichedItems.length,
        restaurant_id,
        restaurant_name: restaurant.name,
        items: enrichedItems.map(item => ({
            name: item.name,
            quantity: item.quantity,
            price: item.unit_price_pln
        })),
        created_at: order.created_at,
        warnings: unavailableItems.length > 0 ? {
            unavailable_items: unavailableItems
        } : undefined
    };
}

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    try {
        const body = req.body || {};
        const result = await createOrder(body);
        return res.status(201).json(result);

    } catch (err) {
        const msg = err.message;
        if (msg === "missing_restaurant_id" || msg === "invalid_restaurant_id" || msg === "missing_items" || msg === "item_missing_id" || msg.startsWith("invalid_item_id")) {
            return res.status(400).json({ ok: false, error: msg });
        }
        if (msg === "restaurant_not_found" || msg === "item_not_found") {
            return res.status(404).json({ ok: false, error: msg });
        }

        console.error("[AI/Order] Error:", msg);
        return res.status(500).json({
            ok: false,
            error: "internal_error",
            message: msg
        });
    }
}
