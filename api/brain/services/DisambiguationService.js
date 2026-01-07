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

    // 1. Pobierz wszystkie pasujące pozycje (bez join, aby uniknąć błędów missing FK)
    const { data: allItems, error } = await supabase
        .from('menu_items_v2')
        .select(`
            id, 
            name, 
            price_pln, 
            restaurant_id
        `);

    if (error) {
        console.error("Disambiguation DB Error (items):", error);
        return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };
    }

    // 2. Filtruj kandydatów (fuzzy)
    const candidates = allItems.filter(item => fuzzyIncludes(item.name, itemName));

    if (candidates.length === 0) {
        return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };
    }

    // 3. Pobierz nazwy restauracji dla znalezionych kandydatów
    // (Manual join, bezpieczniejszy przy braku zdefiniowanych relacji)
    const restaurantIds = [...new Set(candidates.map(c => c.restaurant_id))];

    const { data: restaurants, error: rError } = await supabase
        .from('restaurants')
        .select('id, name')
        .in('id', restaurantIds);

    if (rError || !restaurants) {
        console.error("Disambiguation DB Error (restaurants):", rError);
        // Fallback: zwróć items bez nazw restauracji (choć to słabe)
        // Ale lepiej zwrócić błąd niż crash
        return { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND };
    }

    // 4. Mapuj restauracje do itemów
    candidates.forEach(c => {
        c.restaurants = restaurants.find(r => r.id === c.restaurant_id) || { id: c.restaurant_id, name: 'Unknown' };
    });

    // B) Dokładnie 1 wynik
    if (candidates.length === 1) {
        const unique = candidates[0];
        return {
            status: DISAMBIGUATION_RESULT.ADD_ITEM,
            item: unique,
            restaurant: unique.restaurants
        };
    }

    // B2) Wiele wyników, ale WSZYSTKIE z tej samej restauracji
    // To nie jest konflikt między lokalami. Zwracamy pierwszy (lub w przyszłości: pytamy o rozmiar).
    const uniqueRestaurantIds = [...new Set(candidates.map(c => c.restaurant_id))];
    if (uniqueRestaurantIds.length === 1) {
        const first = candidates[0];
        console.log(`🧠 Same-restaurant ambiguity (${candidates.length} items) in ${first.restaurants.name}. resolving automatically.`);
        return {
            status: DISAMBIGUATION_RESULT.ADD_ITEM,
            item: first,
            restaurant: first.restaurants
        };
    }

    // C) >1 wynik (różne restauracje) - Próba ujednoznacznienia kontekstem
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
