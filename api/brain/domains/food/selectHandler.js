
import { getSession, updateSession } from '../../session/sessionStore.js';
import { fuzzyMatch } from '../../helpers.js';

export class SelectRestaurantHandler {

    async execute(ctx) {
        const { text, session } = ctx;
        console.log(`🧠 SelectRestaurantHandler executing... Pending Dish: "${session?.pendingDish}"`);

        const list = session?.last_restaurants_list || [];
        if (!list || list.length === 0) {
            return {
                reply: "Nie mam listy restauracji. Powiedz najpierw 'znajdź restaurację'.",
                contextUpdates: { expectedContext: 'find_nearby' }
            };
        }

        let selected = null;

        // 1. Try by Index (1, 2, 3...)
        const numMatch = text.match(/(\d+)/);
        if (numMatch) {
            const idx = parseInt(numMatch[1], 10) - 1; // 1-based to 0-based
            if (idx >= 0 && idx < list.length) {
                selected = list[idx];
            }
        }

        // 2. Try by Name (Fuzzy)
        if (!selected) {
            // Check against list names
            // Simple inclusion/fuzzy
            for (const r of list) {
                if (fuzzyMatch(r.name, text) || text.toLowerCase().includes(r.name.toLowerCase())) {
                    selected = r;
                    break;
                }
            }
        }

        if (!selected) {
            return {
                reply: `Nie wiem którą restaurację z listy masz na myśli. Wybierz numer od 1 do ${list.length}.`,
            };
        }

        // 3. Selection Success
        // Build currentRestaurant object for persistence
        const currentRestaurant = {
            id: selected.id,
            name: selected.name,
            city: selected.city || null
        };

        // Feature: Auto-convert to order if we have a pending dish remembered
        if (session?.pendingDish) {
            const dishName = session.pendingDish;
            return {
                reply: `Wybrano ${selected.name}. Rozpoczynam zamawianie: ${dishName}. Coś jeszcze?`,
                should_reply: true,
                actions: [
                    {
                        type: 'create_order',
                        payload: {
                            restaurant: selected,
                            restaurant_id: selected.id,
                            items: [{ name: dishName, quantity: 1 }]
                        }
                    }
                ],
                contextUpdates: {
                    currentRestaurant, // NEW: Persistent restaurant
                    lastRestaurant: selected,
                    lockedRestaurantId: selected.id,
                    expectedContext: 'confirm_order', // Use FSM, not context: 'IN_RESTAURANT'
                    pendingDish: null // Consume the memory
                },
                meta: { source: 'selection_auto_order' }
            };
        }

        return {
            reply: `Wybrano ${selected.name}. Co chcesz zrobić? (Pokaż menu lub zamawiam)`,
            contextUpdates: {
                currentRestaurant, // NEW: Persistent restaurant
                lastRestaurant: selected,
                lockedRestaurantId: selected.id,
                expectedContext: 'restaurant_menu' // Use FSM, not context: 'IN_RESTAURANT'
            },
            meta: { source: 'selection_handler' }
        };
    }
}
