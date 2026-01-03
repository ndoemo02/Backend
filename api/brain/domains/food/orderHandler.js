// Food Domain: Order Handler
// Odpowiada za proces składania zamówienia (Parsowanie -> Koszyk -> Potwierdzenie).

import { extractQuantity } from '../../helpers.js';
import { resolveMenuItemConflict, DISAMBIGUATION_RESULT } from '../../services/DisambiguationService.js';

export class OrderHandler {

    async execute(ctx) {
        const { text, session } = ctx;
        console.log("🧠 OrderHandler executing with disambiguation...");

        // 0. Extract basic info
        const quantity = extractQuantity(text);

        // 1. DISAMBIGUATION CHECK
        // Use the new service to resolve what item user wants
        // We pass the current restaurant context if available
        const currentRestaurantId = session?.lastRestaurant?.id;

        const resolution = await resolveMenuItemConflict(text, {
            restaurant_id: currentRestaurantId
        });

        console.log(`🧠 Disambiguation Result: ${resolution.status}`);

        // CASE A: Item Not Found
        if (resolution.status === DISAMBIGUATION_RESULT.ITEM_NOT_FOUND) {
            const rName = session?.lastRestaurant?.name || "naszej ofercie";
            return {
                reply: `Nie mogę znaleźć tego dania w ${rName}. Spróbuj podać dokładniejszą nazwę.`
            };
        }

        // CASE B: Disambiguation Required (Multi-match, no context)
        if (resolution.status === DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED) {
            const options = resolution.candidates.slice(0, 3); // Limit to 3
            const optionNames = options.map(o => o.restaurant.name).join(", ");

            return {
                reply: `To danie jest dostępne w: ${optionNames}. Z której restauracji chcesz zamówić?`,
                contextUpdates: {
                    expectedContext: 'choose_restaurant',
                    pendingDisambiguation: resolution.candidates // Store for next turn
                }
            };
            // Note: NLU needs to handle 'choose_restaurant' context next
        }

        // CASE C: Success (Single Item Resolved)
        if (resolution.status === DISAMBIGUATION_RESULT.ADD_ITEM) {
            const item = resolution.item;
            const restaurant = resolution.restaurant;

            // Determine if we are switching restaurants
            const isSwitch = currentRestaurantId && currentRestaurantId !== restaurant.id;

            // Build Item Payload
            const orderItem = {
                id: item.id,
                name: item.name,
                price: parseFloat(item.price_pln),
                quantity: quantity
            };
            const total = (orderItem.price * quantity).toFixed(2);

            // Construct Reply
            let reply = "";
            let contextUpdate = {};

            if (isSwitch) {
                // WARN USER about switch!
                reply = `Znaleziono "${item.name}" w ${restaurant.name}. `;
                // Auto-switch logic could be here, but safer to ask?
                // For now, let's assume aggressive helpfulness -> Auto Switch + Inform
                reply += `Dodałam do nowego zamówienia. Razem ${total} zł. Potwierdzasz?`;

                // Clear old cart if needed, or strictly overwrite pendingOrder
                contextUpdate = {
                    lastRestaurant: restaurant, // UPDATE CONTEXT
                    pendingOrder: {
                        restaurant_id: restaurant.id,
                        restaurant: restaurant.name,
                        items: [orderItem],
                        total: total,
                        warning: 'switch_restaurant'
                    }
                };

            } else {
                // Same restaurant or Fresh Start
                reply = `Dodałam ${quantity}x ${item.name} z ${restaurant.name}. Razem ${total} zł. Potwierdzasz?`;

                // If it's a fresh start, allow context set
                contextUpdate = {
                    lastRestaurant: restaurant,
                    pendingOrder: {
                        restaurant_id: restaurant.id,
                        restaurant: restaurant.name,
                        items: [orderItem],
                        total: total
                    }
                };
            }

            return {
                reply,
                contextUpdates: {
                    ...contextUpdate,
                    expectedContext: 'confirm_order',
                    lastIntent: 'create_order'
                }
            };
        }

        return { reply: "Przepraszam, wystąpił nieoczekiwany błąd przy wyszukiwaniu dania." };
    }
}
