/**
 * Food Domain: Find Restaurants
 * Odpowiada za wyszukiwanie restauracji (SQL/Geo).
 */

import { extractLocation, extractCuisineType } from '../../nlu/extractors.js';
import { pluralPl } from '../../utils/formatter.js';

function normalizeLocation(loc) {
    if (!loc) return null;
    const l = loc.toLowerCase();
    if (l.includes('piekar')) return 'Piekary Śląskie';
    if (l.includes('katow')) return 'Katowice';
    if (l.includes('bytom')) return 'Bytom';
    return loc;
}


export class FindRestaurantHandler {
    constructor(repository) {
        this.repo = repository;
    }

    async execute(ctx) {
        const { text, session, entities } = ctx;

        // 1. Parameter Extraction
        // Prefer entities from NLU (already extracted nicely), fallback to manual extract
        let location = entities?.location || extractLocation(text);
        if (!location) location = session?.last_location;
        const cuisineType = entities?.cuisine || extractCuisineType(text);

        // Normalize location for DB
        let normalizedLoc = normalizeLocation(location);

        if (!normalizedLoc) {
            // ... (Logic for asking location remains same)
            // Check if we are asking for "nearby" explicitly without location
            if (/w pobli[zż]u|blisko|tutaj|okolicy/i.test(text)) {
                if (ctx.body && ctx.body.lat && ctx.body.lng) {
                    // Geo logic
                } else {
                    return {
                        reply: "W jakiej miejscowości mam szukać?",
                        contextUpdates: { expectedContext: 'find_nearby_ask_location' }
                    };
                }
            } else {
                return {
                    reply: "Gdzie mam szukać? Podaj miasto.",
                    contextUpdates: { expectedContext: 'find_nearby_ask_location' }
                };
            }
        }

        console.log(`🔎 Searching for ${cuisineType || 'any'} in ${normalizedLoc} (Original: ${location})...`);

        // 3. Fallback: Nearby Cities logic (Legacy Port)
        // Hardcoded Known Cities for Validation
        const KNOWN_CITIES = ['Piekary Śląskie', 'Bytom', 'Radzionków', 'Chorzów', 'Katowice', 'Siemianowice Śląskie', 'Świerklaniec', 'Zabrze', 'Tarnowskie Góry', 'Świętochłowice', 'Mysłowice'];

        // BUGFIX: If extracted location is valid string but NOT in known cities, overwrite with session location if valid
        // This prevents aggressive NLU extraction (e.g. "Zamawiam") from poisoning the search
        if (normalizedLoc && !KNOWN_CITIES.includes(normalizedLoc) && session?.last_location && KNOWN_CITIES.includes(session.last_location)) {
            console.log(`⚠️ Invalid/Unknown location "${normalizedLoc}" detected. Fallback to valid session location: "${session.last_location}"`);
            normalizedLoc = session.last_location;
        }

        let restaurants;
        try {
            restaurants = await this.repo.searchRestaurants(normalizedLoc, cuisineType);
        } catch (error) {
            console.error('Repo Error:', error);
            return { reply: "Mam problem z bazą danych. Spróbuj później.", error: 'db_error' };
        }

        let replyPrefix = "";
        let foundInNearby = false;

        if (!restaurants?.length) {
            const nearbyCitySuggestions = {
                'Piekary Śląskie': ['Bytom', 'Radzionków', 'Chorzów', 'Siemianowice Śląskie', 'Świerklaniec'],
                'Bytom': ['Piekary Śląskie', 'Radzionków', 'Chorzów', 'Zabrze'],
                'Radzionków': ['Piekary Śląskie', 'Bytom', 'Tarnowskie Góry'],
                'Chorzów': ['Katowice', 'Bytom', 'Świętochłowice'],
                'Katowice': ['Chorzów', 'Siemianowice Śląskie', 'Mysłowice'],
            };

            const suggestions = nearbyCitySuggestions[normalizedLoc] || [];

            for (const neighbor of suggestions) {
                console.log(`🔎 Fallback: Checking ${neighbor}...`);
                const neighborRest = await this.repo.searchRestaurants(neighbor, cuisineType);

                if (neighborRest && neighborRest.length > 0) {
                    restaurants = neighborRest;
                    normalizedLoc = neighbor; // Switch context to where we found food
                    replyPrefix = `W ${location} pusto, ale w pobliżu — w ${neighbor} — znalazłam ${neighborRest.length} miejsc.\n\n`;
                    foundInNearby = true;
                    break;
                }
            }
        }

        // 4. Formatting Result
        if (!restaurants || restaurants.length === 0) {
            const cuisineMsg = cuisineType ? ` serwujących ${cuisineType}` : '';
            return {
                reply: `Nie znalazłam żadnych restauracji w ${location}${cuisineMsg}. Może inna kuchnia?`,
                contextUpdates: {
                    last_location: normalizedLoc,
                    // Feature: Keep dish in memory even if search failed, in case user provides a specific place next
                    pendingDish: entities?.dish || (entities?.items && entities.items[0]?.name) || null
                }
            };
        }

        const count = restaurants.length;
        const countTxt = pluralPl(count, 'miejsce', 'miejsca', 'miejsc');

        // Logic limit
        const limit = 3;
        const displayList = restaurants.slice(0, limit);
        const listTxt = displayList.map((r, i) => `${i + 1}. ${r.name} (${r.cuisine_type || 'Restauracja'})`).join('\n');

        const intro = foundInNearby ? replyPrefix : `Znalazłam ${count} ${countTxt} w ${normalizedLoc}:`;
        const closing = "Którą wybierasz?";
        const reply = `${intro}\n${listTxt}\n\n${closing}`;

        // Smart Context Hint for Frontend
        const suggestedRestaurants = restaurants.map((r, idx) => ({
            id: r.id, name: r.name, index: idx + 1, city: r.city
        }));

        return {
            reply,
            closing_question: closing,
            restaurants: restaurants, // Full list sent to frontend (only for discovery intents!)
            menuItems: [], // PARITY
            contextUpdates: {
                last_location: normalizedLoc,
                last_restaurants_list: restaurants,
                lastRestaurants: suggestedRestaurants,
                expectedContext: 'select_restaurant',
                // Feature: Remember implicit dish for subsequent selection
                pendingDish: entities?.dish || (entities?.items && entities.items[0]?.name) || null
            }
        };
    }
}
