/**
 * Food Domain: Order Handler
 * Odpowiada za proces składania zamówienia (Parsowanie -> Koszyk -> Potwierdzenie).
 */

import { parseOrderItems } from '../../orderService.js';
import { getSession } from '../../context.js'; // Legacy context helper
// import { parseOrderItems } from '../../intent-router.js'; // Use orderService wrapper which likely wraps intent-router logic
// Wait, `orderService.js` usually wraps `intent-router.js` logic.
// In createOrderHandler.js: import { parseOrderItems, normalize } from "../orderService.js";

export class OrderHandler {

    async execute(ctx) {
        const { text, session } = ctx;
        console.log("🧠 OrderHandler executing...");

        // 1. Walidacja Kontekstu (Restauracja)
        const restaurant = session?.lastRestaurant;
        if (!restaurant) {
            return {
                reply: "Najpierw wybierz restaurację, z której chcesz zamówić. Powiedz 'pokaż restauracje w pobliżu'."
            };
        }

        // 2. Parsowanie Zamówienia (NLP -> Items)
        const items = await parseOrderItems(text, restaurant.id);

        if (!items || items.length === 0) {
            // Smart Fallback (did not understand dish)
            return {
                reply: `Nie zrozumiałam co chcesz zamówić z ${restaurant.name}. Spróbuj użyć dokładnej nazwy z menu.`
            };
        }

        // 3. Kalkulacja
        const total = items.reduce((sum, item) => sum + (item.price_pln * item.quantity), 0);

        // 4. Budowanie Payloadu (Pending Order)
        const pendingOrder = {
            restaurant_id: restaurant.id,
            restaurant_details: restaurant,
            items: items,
            total: total.toFixed(2)
        };

        const itemsList = items.map(i => `${i.quantity}x ${i.name}`).join(", ");
        const reply = `Dodałam ${itemsList} do zamówienia. Razem ${total.toFixed(2)} zł. Potwierdzasz?`;

        // 5. Zwracanie Wyniku
        return {
            reply,
            contextUpdates: {
                pendingOrder,
                expectedContext: 'confirm_order',
                lastIntent: 'create_order'
            }
        };
    }
}
