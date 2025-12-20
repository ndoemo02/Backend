/**
 * Food Domain: Find Restaurants
 * Odpowiada za wyszukiwanie restauracji (SQL/Geo).
 */

import { supabase } from '../../../_supabase.js';
import { expandCuisineType, extractCuisineType } from '../../restaurant/cuisine.js'; // Reusing legacy helpers
import { extractLocation } from '../../helpers.js';
import { pluralPl } from '../../utils/formatter.js';

export class FindRestaurantHandler {

    async execute(ctx) {
        const { text, session, entities } = ctx;

        // 1. Parameter Extraction (Domain Specific)
        // Router entities take precedence if extracted
        let location = extractLocation(text);

        console.log(`🔎 FindHandler Debug: Text="${text}", NLU_Loc="${entities?.location}", Extract_Loc="${location}"`);
        console.log("DEBUG REGEX MATCH:", text.match(/w\s+([A-Z][a-z]+)/));

        if (entities?.location) {
            location = entities.location;
        }
        // Fallback to session
        if (!location) {
            location = session?.last_location;
        }
        const cuisineType = extractCuisineType(text); // or from entities

        if (!location) {
            return {
                reply: "Gdzie mam szukać? Podaj miasto lub powiedz 'w pobliżu'.",
                contextUpdates: { expectedContext: 'find_nearby_ask_location' } // Example
            };
        }

        // 2. Data Fetching (Interaction with DB - NOT Brain)
        console.log(`🔎 Searching for ${cuisineType || 'all'} in ${location}...`);

        let query = supabase
            .from('restaurants')
            .select('id, name, address, city, cuisine_type, lat, lng')
            .ilike('city', `%${location}%`);

        if (cuisineType) {
            const types = expandCuisineType(cuisineType) || [cuisineType];
            if (types.length > 1) query = query.in('cuisine_type', types);
            else query = query.eq('cuisine_type', types[0]);
        }

        const { data: restaurants, error } = await query.limit(10);

        console.log(`🔎 FindHandler DB Result: ${restaurants?.length} rows. Error: ${error?.message}`);

        if (error) {
            console.error('DB Error:', error);
            // Systemowy fallback - nie udawaj że nic nie ma
            return {
                reply: "Mam problem z połączeniem z bazą danych restauracji. Spróbuj za moment.",
                error: 'db_error'
            };
        }

        // 3. Logic & Formatting
        if (!restaurants || restaurants.length === 0) {
            return {
                reply: `Nie znalazłam żadnych restauracji w ${location}${cuisineType ? ` serwujących ${cuisineType}` : ''}.`,
                data: []
            };
        }

        // Format Reply
        const count = restaurants.length;
        const countTxt = `${count} ${pluralPl(count, 'restaurację', 'restauracje', 'restauracji')}`;

        // Ogranicz do 3 na start
        const displayList = restaurants.slice(0, 3);
        const listTxt = displayList.map((r, i) => `${i + 1}. ${r.name} (${r.cuisine_type})`).join('\n');

        const reply = `Znalazłam ${countTxt} w ${location}:\n${listTxt}\n\nKtórą wybierasz?`;

        // 4. Return Result
        return {
            reply,
            restaurants: restaurants, // Full list for frontend map/state
            contextUpdates: {
                last_location: location,
                last_restaurants_list: restaurants,
                expectedContext: 'select_restaurant'
            }
        };
    }


}
