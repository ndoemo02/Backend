/**
 * Food Domain: Menu Handler
 * Odpowiada za wyświetlanie karty dań (Menu).
 */

import { loadMenuPreview } from '../../menuService.js';
import { findRestaurantByName, getLocationFallback } from '../../locationService.js';

export class MenuHandler {

    async execute(ctx) {
        const { text, session, entities } = ctx;
        console.log("🧠 MenuHandler executing...");

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
                        reply: "Listę dań masz na ekranie. Czy coś wpadło Ci w oko?",
                        menu: items,
                        meta: { source: 'cache_anti_loop', latency_total_ms: 0 },
                        contextUpdates: { expectedContext: 'menu_or_order' }
                    };
                }

                return {
                    reply: `W ${lastRestaurant.name} polecam: ${items.map(m => m.name).join(', ')}. Co podać?`,
                    menu: items,
                    meta: { source: 'cache', latency_total_ms: 0 }, // Latency calc elsewhere, source is key
                    contextUpdates: { expectedContext: 'menu_or_order' }
                };
            }
        }

        // 1. Zidentyfikuj restaurację
        let restaurant = null;

        // A) Jawnie w tekście
        if (entities?.restaurant) { // Z entity extraction
            restaurant = await findRestaurantByName(entities.restaurant);
        } else if (entities?.raw && session?.expectedContext === 'select_restaurant') {
            // Context-lock handled differently
        }

        // B) Z sesji (Context)
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

        // --- ANTI-LOOP: Short Mode ---
        // Jeśli user pyta o menu drugi raz z rzędu (lub system źle usłyszał szum), nie czytaj całej listy od nowa.
        if (session.lastIntent === 'show_menu' || session.lastIntent === 'menu_request') {
            console.log(`⚡ Anti-Loop: Sending short menu reply for ${restaurant.name}`);
            return {
                reply: "Listę dań masz na ekranie. Czy coś wpadło Ci w oko?",
                menu: preview.shortlist,
                contextUpdates: {
                    expectedContext: 'menu_or_order',
                    lastRestaurant: restaurant,
                    context: 'IN_RESTAURANT', // Ensure lock persists
                    lockedRestaurantId: restaurant.id
                },
                meta: { source: 'anti_loop' }
            };
        }

        const count = preview.menu.length;
        const shown = preview.shortlist.length;
        const listText = preview.shortlist.map(m => `${m.name} (${Number(m.price_pln).toFixed(2)} zł)`).join(", ");

        const reply = `W ${restaurant.name} mamy ${count} pozycji. Polecam np.: ${listText}. Co zamawiasz?`;

        console.log(`✅ MenuHandler: showing ${shown}/${count} items for ${restaurant.name}`);

        return {
            reply,
            menu: preview.shortlist,
            contextUpdates: {
                last_menu: preview.shortlist,
                lastRestaurant: restaurant,
                expectedContext: 'menu_or_order',
                // --- Task 1: Implicit Lock on successful menu load ---
                // "Skoro user prosi o menu tej restauracji, blokujemy kontekst"
                context: 'IN_RESTAURANT',
                lockedRestaurantId: restaurant.id
            },
            meta: { source: 'db' }
        };
    }
}
