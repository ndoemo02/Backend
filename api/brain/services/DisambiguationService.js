/**
 * DisambiguationService.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Deterministyczna warstwa ujednoznaczniania pozycji w menu.
 * Rozwiązuje konflikty nazw między restauracjami.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '../../_supabase.js'; // Adjust path if needed (depth 2 from domains/food, depth 1 from services)
// Wait, path from services/DisambiguationService.js (level 3) to api/_supabase.js (level 1) is ../../_supabase.js
import { fuzzyIncludes, normalize } from '../helpers.js';

export const DISAMBIGUATION_RESULT = {
    ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
    ADD_ITEM: 'ADD_ITEM',
    DISAMBIGUATION_REQUIRED: 'DISAMBIGUATION_REQUIRED'
};

/**
 * Rozwiązuje konflikty nazw dań w menu.
 * 
 * @param {string} itemName - Nazwa dania (lub znormalizowany tekst użytkownika)
 * @param {object} context - Kontekst (restaurant_id, list of previously viewed, etc.)
 * @returns {Promise<{status: string, item?: object, restaurant?: object, candidates?: array}>}
 */
export async function resolveMenuItemConflict(itemName, context = {}) {
    if (!itemName) return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };

    console.log(`🧠 Disambiguation: Searching for "${itemName}"...`);

    // 1. Pobierz wszystkie pasujące pozycje ze wszystkich restauracji
    // Optymalizacja: pobieramy name, restaurant_id i cenę
    const { data: allItems, error } = await supabase
        .from('menu_items_v2')
        .select(`
            id, 
            name, 
            price_pln, 
            restaurant_id,
            restaurants (id, name)
        `);

    if (error) {
        console.error("Disambiguation DB Error:", error);
        return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };
    }

    // 2. Filtruj w pamięci (fuzzy logic)
    // Używamy fuzzyIncludes z helpers.js dla spójności
    const candidates = allItems.filter(item => fuzzyIncludes(item.name, itemName));

    console.log(`🧠 Candidates found: ${candidates.length}`, candidates.map(c => `${c.name} (${c.restaurants?.name})`));

    // A) Brak wyników
    if (candidates.length === 0) {
        return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };
    }

    // B) Dokładnie 1 wynik
    if (candidates.length === 1) {
        const unique = candidates[0];
        return {
            status: DISAMBIGUATION_RESULT.ADD_ITEM,
            item: unique,
            restaurant: unique.restaurants
        };
    }

    // C) >1 wynik - Próba ujednoznacznienia kontekstem
    // Priorytet 1: Obecna restauracja (context.restaurant_id)
    if (context.restaurant_id) {
        const inContext = candidates.find(c => c.restaurant_id === context.restaurant_id);
        if (inContext) {
            console.log(`🧠 Context match: ${inContext.name} in ${inContext.restaurants.name}`);
            return {
                status: DISAMBIGUATION_RESULT.ADD_ITEM,
                item: inContext,
                restaurant: inContext.restaurants
            };
        }
    }

    // Priorytet 2: Unikalność nazwy (jeśli user podał bardzo dokładną nazwę)
    // Np. "Burger Drwala" może być tylko w Maku, nawet jeśli "Burger" jest wszędzie
    // Sprawdźmy Exact Match (case insensitive)
    const exactMatches = candidates.filter(c => normalize(c.name) === normalize(itemName));
    if (exactMatches.length === 1) {
        const unique = exactMatches[0];
        return {
            status: DISAMBIGUATION_RESULT.ADD_ITEM,
            item: unique,
            restaurant: unique.restaurants
        };
    }

    // D) Nadal niejednoznaczne -> Wymagane ujednoznacznienie
    // Grupuj kandydatów po restauracjach
    const restaurantCandidates = candidates.reduce((acc, curr) => {
        const rid = curr.restaurant_id;
        if (!acc[rid]) {
            acc[rid] = {
                restaurant: curr.restaurants,
                items: []
            };
        }
        acc[rid].items.push(curr);
        return acc;
    }, {});

    return {
        status: DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED,
        candidates: Object.values(restaurantCandidates).map(g => ({
            restaurant: g.restaurant,
            items: g.items
        }))
    };
}
