/**
 * OrderPersistence.js
 * ═══════════════════════════════════════════════════════════════════════════
 * JEDYNA CENTRALNA ŚCIEŻKA ZAPISU ZAMÓWIENIA DO DB
 * 
 * Ten plik jest SINGLE SOURCE OF TRUTH dla persystencji zamówień.
 * NIE zapisuj zamówień w:
 *   - CartContext.jsx (UI) ← DEPRECATED
 *   - HomeClassic.jsx (legacy) ← DEPRECATED  
 *   - api/orders.js (legacy endpoints) ← DEPRECATED dla voice flow
 *   - pipeline.js (TTS/streaming)
 * 
 * Wywołanie: po confirm_order, PRZED streamem/TTS
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '../../_supabase.js';
import crypto from 'node:crypto';

/**
 * Generuje deterministyczny hash dla koszyka (idempotencja)
 */
function generateCartHash(sessionId, items) {
    const payload = JSON.stringify({
        sid: sessionId,
        items: (items || []).map(i => ({
            name: i.name,
            qty: i.qty || i.quantity || 1,
            price: i.price_pln || i.price || 0
        })).sort((a, b) => a.name.localeCompare(b.name))
    });

    // Simple hash using crypto
    return crypto.createHash('sha256').update(payload).digest('hex').substring(0, 32);
}

/**
 * Zapisuje zamówienie do DB - IDEMPOTENTNIE
 * 
 * @param {string} sessionId - ID sesji głosowej
 * @param {object} session - Obiekt sesji z cart/user/context
 * @param {object} options - Dodatkowe opcje (restaurant_id, user_id, etc.)
 * @returns {Promise<{success: boolean, order_id?: string, error?: string, skipped?: boolean}>}
 */
export async function persistOrderToDB(sessionId, session, options = {}) {
    const fnTag = '[OrderPersistence]';

    try {
        // 1. Walidacja
        const cart = session?.cart;
        if (!cart || !cart.items || cart.items.length === 0) {
            console.log(`${fnTag} Skip: Empty cart`);
            return { success: false, error: 'empty_cart' };
        }

        // 2. Generuj idempotency key (hash koszyka + sessionId)
        const cartHash = generateCartHash(sessionId, cart.items);
        console.log(`${fnTag} Cart hash: ${cartHash}`);

        // 3. Sprawdź czy zamówienie już istnieje (idempotencja)
        const { data: existing, error: checkError } = await supabase
            .from('orders')
            .select('id')
            .eq('idempotency_key', cartHash)
            .maybeSingle();

        if (checkError) {
            console.error(`${fnTag} Check error:`, checkError.message);
            // Kontynuuj mimo błędu - może kolumna nie istnieje
        }

        if (existing) {
            console.log(`${fnTag} Order already exists: ${existing.id} (idempotent skip)`);
            return { success: true, order_id: existing.id, skipped: true };
        }

        // 4. Przygotuj dane zamówienia
        const firstItem = cart.items[0] || {};
        const restaurantId = options.restaurant_id || firstItem.restaurant_id || session?.lastRestaurant?.id || null;
        const restaurantName = options.restaurant_name || firstItem.restaurant_name || session?.lastRestaurant?.name || 'Unknown';

        const totalPLN = Number(cart.total || 0);
        const totalCents = Math.round(totalPLN * 100);

        const orderData = {
            // Identyfikatory
            user_id: options.user_id || session?.user_id || null,
            restaurant_id: restaurantId,
            restaurant_name: restaurantName,
            session_id: sessionId,
            idempotency_key: cartHash,

            // Pozycje i suma
            items: cart.items.map(item => ({
                menu_item_id: item.id || null,
                name: item.name || 'pozycja',
                unit_price_cents: Math.round((item.price_pln || item.price || 0) * 100),
                qty: item.qty || item.quantity || 1
            })),
            total_price: totalPLN, // PLN (float) - standard dla Dashboardów
            total_cents: totalCents, // Cents (integer) - dla precyzji analitycznej

            // Status
            // Zmieniamy na 'confirmed', ponieważ Voice Flow v2 zapisuje zamówienie
            // JEDYNIE gdy intencja 'confirm_order' została przetworzona przez Brain.
            status: 'confirmed',

            // Timestamps
            created_at: new Date().toISOString()
        };

        console.log(`${fnTag} Persisting order:`, {
            restaurant: restaurantName,
            items: orderData.items.length,
            total: cart.total
        });

        // 5. Zapisz do DB
        const { data: order, error: insertError } = await supabase
            .from('orders')
            .insert([orderData])
            .select('id')
            .single();

        if (insertError) {
            console.error(`${fnTag} Insert error:`, insertError.message);

            // Fallback: spróbuj bez idempotency_key (jeśli kolumna nie istnieje)
            if (insertError.message.includes('idempotency_key')) {
                delete orderData.idempotency_key;
                const { data: order2, error: insertError2 } = await supabase
                    .from('orders')
                    .insert([orderData])
                    .select('id')
                    .single();

                if (insertError2) {
                    return { success: false, error: insertError2.message };
                }

                console.log(`${fnTag} ✅ Order persisted (no idempotency): ${order2.id}`);
                return { success: true, order_id: order2.id };
            }

            return { success: false, error: insertError.message };
        }

        console.log(`${fnTag} ✅ Order persisted: ${order.id}`);
        return { success: true, order_id: order.id };

    } catch (err) {
        console.error(`${fnTag} Unexpected error:`, err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Sprawdza czy zamówienie dla danej sesji już istnieje
 */
export async function orderExistsForSession(sessionId, cartHash) {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('id')
            .or(`session_id.eq.${sessionId},idempotency_key.eq.${cartHash}`)
            .limit(1)
            .maybeSingle();

        return { exists: !!data, order_id: data?.id };
    } catch (err) {
        return { exists: false, error: err.message };
    }
}
