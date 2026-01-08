/**
 * Food Domain: Menu Handler
 * Odpowiada za wyświetlanie karty dań (Menu).
 */

import { loadMenuPreview } from '../../menuService.js';
import { findRestaurantByName, getLocationFallback } from '../../locationService.js';
import { RESTAURANT_CATALOG } from '../../data/restaurantCatalog.js';

export class MenuHandler {

    async execute(ctx) {
        const { text, session, entities } = ctx;
        console.log(`🧠 MenuHandler executing for session ${session?.id}. Text: "${text}"`);
        console.log(`🧠 MenuHandler: session lastRestaurant: ${session?.lastRestaurant?.name} (${session?.lastRestaurant?.id})`);
        console.log(`🧠 MenuHandler: entities:`, JSON.stringify(entities));

        // --- OPTIMIZATION: Task 2 - Menu Cache Shortcut ---
        // If we have a locked/known restaurant and cached menu, return immediately
        // Note: session.lastRestaurantId is sometimes just id in session.lastRestaurant.id
        const lastRestaurant = session?.lastRestaurant;
        if (lastRestaurant && session?.last_menu && session.last_menu.length > 0) {
            // Additional semantic check: Does user want to change restaurant?
            // Handled by NLU. If we are here, intent is menu_request.
            // Check if user specifically asked for current restaurant or vague.
            // If entities.restaurant is defined and DIFFERENT from current, ignore cache

            let useCache = true;
            if (entities?.restaurant) {
                // Check name match
                if (lastRestaurant.name.toLowerCase() !== entities.restaurant.toLowerCase()) {
                    useCache = false;
                }
            }

            if (useCache) {
                console.log(`⚡ Cache Hit: Returning cached menu for ${lastRestaurant.name}`);
                const items = session.last_menu;

                // Anti-Loop for Cache
                if (session.lastIntent === 'show_menu' || session.lastIntent === 'menu_request') {
                    return {
                        intent: 'menu_request', // Standard V2
                        reply: "Listę dań masz na ekranie. Czy coś wpadło Ci w oko?",
                        menuItems: items,
                        restaurants: [],
                        meta: { source: 'cache_anti_loop', latency_total_ms: 0 },
                        contextUpdates: { expectedContext: 'menu_or_order' }
                    };
                }

                return {
                    intent: 'menu_request', // Standard V2
                    reply: `Wybrano restaurację ${lastRestaurant.name}. Polecam: ${items.map(m => m.name).join(', ')}. Co podać?`,
                    menuItems: items,
                    restaurants: [],
                    meta: { source: 'cache', latency_total_ms: 0 }, // Latency calc elsewhere, source is key
                    contextUpdates: { expectedContext: 'menu_or_order' }
                };
            }
        }

        // 1. Zidentyfikuj restaurację
        let restaurant = null;

        // A) Jawnie w tekście (ID z katalogu ma priorytet)
        if (entities?.restaurantId) {
            const catalogMatch = RESTAURANT_CATALOG.find(r => r.id === entities.restaurantId);
            if (catalogMatch) restaurant = catalogMatch;
        }

        // B) Jawnie w tekście (nazwa jeśli ID brak - np. spoza katalogu)
        if (!restaurant && entities?.restaurant) {
            restaurant = await findRestaurantByName(entities.restaurant);
        }

        // C) Z sesji (Context)
        if (!restaurant) {
            restaurant = session?.lastRestaurant;
        }

        // 2. Walidacja: Brak restauracji
        if (!restaurant) {
            const fallback = await getLocationFallback(
                session?.id,
                session?.last_location,
                "Najpierw wybierz restaurację w {location}, a potem pokażę menu:\n{list}\n\nKtóra Cię interesuje?"
            );

            if (fallback) {
                return { reply: fallback };
            }

            return {
                reply: "Najpierw wybierz restaurację. Powiedz 'gdzie zjeść w pobliżu' aby zobaczyć listę.",
                contextUpdates: { expectedContext: 'find_nearby' }
            };
        }

        // 3. Pobierz Menu (DB)
        const preview = await loadMenuPreview(restaurant.id, {});

        if (!preview || !preview.menu || !preview.menu.length) {
            return {
                reply: `Przepraszam, ale nie mam jeszcze menu dla ${restaurant.name}.`,
            };
        }

        // 4. Formatowanie odpowiedzi

        // --- Anti-Loop Protection (DISABLED for Frontend Safety) ---
        // if (session.lastIntent === 'show_menu' || session.lastIntent === 'menu_request') {
        //     console.log(`⚡ Anti-Loop: Sending short menu reply for ${restaurant.name}`);
        //     return {
        //         intent: 'show_menu', // FORCE LEGACY INTENT NAME
        //         reply: "Listę dań masz na ekranie. Czy coś wpadło Ci w oko?",
        //         menu: preview.shortlist,
        //         restaurant: restaurant, // Ensure restaurant is passed
        //         contextUpdates: {
        //             last_menu: preview.shortlist,
        //             lastRestaurant: restaurant,
        //             lastIntent: 'show_menu', // Consistency
        //             expectedContext: 'create_order',
        //             context: 'IN_RESTAURANT', // Ensure lock persists
        //             lockedRestaurantId: restaurant.id
        //         },
        //         meta: { source: 'anti_loop' }
        //     };
        // }

        const count = preview.menu.length;
        const shown = preview.shortlist.length;
        const listText = preview.shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ");
        const intro = `Wybrano restaurację ${restaurant.name}. W menu m.in.:`;
        const closing = "Co podać?";
        const reply = `${intro}\n${listText}\n\n${closing}`;

        console.log(`✅ MenuHandler: showing ${shown}/${count} items for ${restaurant.name}`);

        return {
            intent: 'menu_request', // Standard V2 intent name
            reply,
            closing_question: closing,
            menuItems: preview.shortlist,
            menu: preview.shortlist, // Legacy compat
            restaurants: [],
            restaurant: restaurant, // CRITICAL: Frontend needs restaurant details (name, etc.)
            contextUpdates: {
                last_menu: preview.shortlist,
                lastRestaurant: restaurant,
                expectedContext: 'create_order',
                lastIntent: 'menu_request', // Consistency
                // --- Task 1: Implicit Lock on successful menu load ---
                // "Skoro user prosi o menu tej restauracji, blokujemy kontekst"
                context: 'IN_RESTAURANT',
                lockedRestaurantId: restaurant.id
            },
            meta: { source: 'db' }
        };
    }
}
