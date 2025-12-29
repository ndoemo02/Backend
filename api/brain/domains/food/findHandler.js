/**
 * Food Domain: Find Restaurants
 * Odpowiada za wyszukiwanie restauracji (SQL/Geo).
 */

import { supabase } from '../../../_supabase.js';
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
            // Check if we are asking for "nearby" explicitly without location
            if (/w pobli[zż]u|blisko|tutaj|okolicy/i.test(text)) {
                // If we have Lat/Lng in body, we could use that. For now, prompt user.
                // TODO: Implement Geo-search if coords available
                if (ctx.body && ctx.body.lat && ctx.body.lng) {
                    // Geo logic would go here
                } else {
                    return {
                        reply: "W jakiej miejscowości mam szukać?",
                        contextUpdates: { expectedContext: 'find_nearby_ask_location' }
                    };
                }
            } else {
                // Default prompt
                return {
                    reply: "Gdzie mam szukać? Podaj miasto.",
                    contextUpdates: { expectedContext: 'find_nearby_ask_location' }
                };
            }
        }

        console.log(`🔎 Searching for ${cuisineType || 'any'} in ${normalizedLoc} (Original: ${location})...`);

        // 2. Primary Search
        let { data: restaurants, error } = await this.queryDb(normalizedLoc, cuisineType);

        let replyPrefix = "";
        let foundInNearby = false;

        // 3. Fallback: Nearby Cities logic (Legacy Port)
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
                const { data: neighborRest, error: nErr } = await this.queryDb(neighbor, cuisineType);

                if (neighborRest && neighborRest.length > 0) {
                    restaurants = neighborRest;
                    normalizedLoc = neighbor; // Switch context to where we found food
                    replyPrefix = `W ${location} pusto, ale w pobliżu — w ${neighbor} — znalazłam ${neighborRest.length} miejsc.\n\n`;
                    foundInNearby = true;
                    break;
                }
            }
        }

        if (error) {
            console.error('DB Error:', error);
            return { reply: "Mam problem z bazą danych. Spróbuj później.", error: 'db_error' };
        }

        // 4. Formatting Result
        if (!restaurants || restaurants.length === 0) {
            const cuisineMsg = cuisineType ? ` serwujących ${cuisineType}` : '';
            return {
                reply: `Nie znalazłam żadnych restauracji w ${location}${cuisineMsg}. Może inna kuchnia?`,
                contextUpdates: { last_location: normalizedLoc }
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
                expectedContext: 'select_restaurant'
            }
        };
    }

    async queryDb(city, cuisineType) {
        let query = supabase
            .from('restaurants')
            .select('id, name, address, city, cuisine_type, lat, lng')
            .ilike('city', `%${city}%`);

        if (cuisineType) {
            // Use legacy expandCuisineType logic if needed, or simple ILIKE
            // For exact parity, we should import expandCuisineType. 
            // Assuming simplified exact match or mapped types for now as per V2 standard.
            query = query.ilike('cuisine_type', `%${cuisineType}%`);
        }

        return await query.limit(10);
    }
}
