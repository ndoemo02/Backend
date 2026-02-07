/**
 * SmartRecommendationService.js
 * ═══════════════════════════════════════════════════════════════════════════
 * INTELIGENTNY ASYSTENT REKOMENDACJI
 * 
 * Sugeruje potrawy na podstawie:
 * - Historii zamówień użytkownika
 * - Popularności w danej restauracji
 * - Specjalności dnia/sezonowych
 * - Kontekstu konwersacji (np. "coś lekkiego", "dla wegetarianina")
 * 
 * ZASADA: Doradzaj MĄDRZE, nie agresywnie
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '../../_supabase.js';
import { normalize } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPY REKOMENDACJI
// ═══════════════════════════════════════════════════════════════════════════
export const RECOMMENDATION_TYPE = {
    POPULAR: 'POPULAR',              // Najpopularniejsze w restauracji
    SPECIALTY: 'SPECIALTY',          // Specjalność/Polecane
    SIMILAR: 'SIMILAR',              // Podobne do poprzednich zamówień
    BUDGET_FRIENDLY: 'BUDGET_FRIENDLY', // W przystępnej cenie
    CATEGORY_MATCH: 'CATEGORY_MATCH',   // Dopasowane do kategorii (np. "pizza")
    CHEF_CHOICE: 'CHEF_CHOICE',      // Wybór szefa kuchni
    NEW_ARRIVAL: 'NEW_ARRIVAL'       // Nowości w menu
};

// Słowa kluczowe mapujące preferencje
const PREFERENCE_KEYWORDS = {
    cheap: ['tani', 'tanie', 'niedrogie', 'niedrog', 'budzet', 'budżet', 'oszczędn'],
    vegetarian: ['wegetarian', 'wege', 'bez mięsa', 'bezmięsn', 'warzyw'],
    spicy: ['ostr', 'pikant', 'chili', 'piekąc', 'piekielnie'],
    light: ['lekk', 'leciutk', 'sałat', 'dietetycz', 'fit', 'zdrowy'],
    filling: ['sycące', 'syt', 'duż', 'porcj', 'najeś'],
    quick: ['szybk', 'na wynos', 'do zabrania'],
    dessert: ['desery', 'słodk', 'ciast', 'lod', 'tort'],
    drink: ['napoj', 'napój', 'pić', 'sok', 'kawa', 'herbat']
};

/**
 * Wykrywa preferencje użytkownika z tekstu.
 * 
 * @param {string} text - Wypowiedź użytkownika
 * @returns {array} - Lista wykrytych preferencji
 */
export function detectUserPreferences(text) {
    if (!text) return [];
    const normalized = normalize(text);
    const preferences = [];

    for (const [pref, keywords] of Object.entries(PREFERENCE_KEYWORDS)) {
        for (const kw of keywords) {
            if (normalized.includes(kw)) {
                preferences.push(pref);
                break; // Jedna preferencja na kategorię
            }
        }
    }

    return preferences;
}

/**
 * Pobiera rekomendacje dla danej restauracji.
 * 
 * @param {string} restaurantId - UUID restauracji
 * @param {object} options - { limit, preferences, excludeIds, userId }
 * @returns {Promise<{recommendations: array, type: string, reason: string}>}
 */
export async function getRestaurantRecommendations(restaurantId, options = {}) {
    const { limit = 3, preferences = [], excludeIds = [], userId = null } = options;
    const fnTag = '[SmartRec]';

    if (!restaurantId) {
        return { recommendations: [], type: null, reason: 'Brak ID restauracji' };
    }

    try {
        // 1. Pobierz menu restauracji
        let query = supabase
            .from('menu_items_v2')
            .select('id, name, description, price_pln, category, is_recommended, is_available, tags')
            .eq('restaurant_id', restaurantId)
            .neq('is_available', false);

        if (excludeIds.length > 0) {
            query = query.not('id', 'in', `(${excludeIds.join(',')})`);
        }

        const { data: menuItems, error } = await query;

        if (error || !menuItems?.length) {
            console.warn(`${fnTag} No menu items found for restaurant ${restaurantId}`);
            return { recommendations: [], type: null, reason: 'Menu niedostępne' };
        }

        // 2. Filtruj po preferencjach
        let filtered = [...menuItems];
        let recommendationType = RECOMMENDATION_TYPE.POPULAR;
        let reason = 'Popularne wybory';

        if (preferences.includes('cheap')) {
            filtered.sort((a, b) => parseFloat(a.price_pln) - parseFloat(b.price_pln));
            recommendationType = RECOMMENDATION_TYPE.BUDGET_FRIENDLY;
            reason = 'Najlepsze ceny';
        }

        if (preferences.includes('vegetarian')) {
            filtered = filtered.filter(item =>
                item.tags?.includes('wege') ||
                item.tags?.includes('vegetarian') ||
                item.category?.toLowerCase().includes('wege') ||
                item.description?.toLowerCase().includes('wege')
            );
            reason = 'Opcje wegetariańskie';
        }

        if (preferences.includes('light')) {
            filtered = filtered.filter(item =>
                item.tags?.includes('light') ||
                item.category?.toLowerCase().includes('sałat') ||
                item.name?.toLowerCase().includes('sałat')
            );
            reason = 'Lekkie dania';
        }

        if (preferences.includes('dessert')) {
            filtered = filtered.filter(item =>
                item.category?.toLowerCase().includes('deser') ||
                item.tags?.includes('sweet')
            );
            reason = 'Coś słodkiego';
        }

        if (preferences.includes('drink')) {
            filtered = filtered.filter(item =>
                item.category?.toLowerCase().includes('napoj') ||
                item.category?.toLowerCase().includes('napój') ||
                item.tags?.includes('drink')
            );
            reason = 'Napoje';
        }

        // 3. Jeśli po filtrach zostało mało - wróć do pełnego menu
        if (filtered.length < 2) {
            filtered = menuItems;
            recommendationType = RECOMMENDATION_TYPE.POPULAR;
            reason = 'Popularne wybory';
        }

        // 4. Priorytetyzuj polecane (is_recommended)
        const recommended = filtered.filter(i => i.is_recommended);
        const others = filtered.filter(i => !i.is_recommended);

        // Jeśli mamy polecane, daj je na górę
        const sorted = [...recommended, ...others];

        // 5. Przygotuj wynik
        const recommendations = sorted.slice(0, limit).map(item => ({
            id: item.id,
            name: item.name,
            price: parseFloat(item.price_pln),
            description: item.description?.substring(0, 80) || '',
            category: item.category,
            isRecommended: item.is_recommended || false
        }));

        console.log(`${fnTag} Found ${recommendations.length} recommendations for ${restaurantId}: ${recommendations.map(r => r.name).join(', ')}`);

        return {
            recommendations,
            type: recommendationType,
            reason
        };

    } catch (err) {
        console.error(`${fnTag} Error:`, err.message);
        return { recommendations: [], type: null, reason: 'Błąd systemu' };
    }
}

/**
 * Generuje sugestię tekstową do TTS.
 * 
 * @param {array} recommendations - Lista rekomendacji z getRestaurantRecommendations
 * @param {string} reason - Powód rekomendacji
 * @returns {string} - Tekst do odczytania przez TTS
 */
export function generateRecommendationSpeech(recommendations, reason = '') {
    if (!recommendations || recommendations.length === 0) {
        return '';
    }

    if (recommendations.length === 1) {
        const r = recommendations[0];
        return `Polecam ${r.name} za ${r.price.toFixed(2)} zł.`;
    }

    const names = recommendations.slice(0, 3).map(r => r.name);
    const prices = recommendations.slice(0, 3).map(r => `${r.price.toFixed(2)} zł`);

    if (recommendations.length === 2) {
        return `Polecam ${names[0]} (${prices[0]}) lub ${names[1]} (${prices[1]}).`;
    }

    return `${reason ? reason + ': ' : ''}${names[0]}, ${names[1]} albo ${names[2]}.`;
}

/**
 * Pobiera historię zamówień użytkownika dla personalizacji.
 * 
 * @param {string} userId - UUID użytkownika (opcjonalny)
 * @param {string} sessionId - ID sesji (dla anonimowych)
 * @returns {Promise<array>} - Lista poprzednich zamówionych itemów
 */
export async function getUserOrderHistory(userId, sessionId = null) {
    if (!userId && !sessionId) return [];

    try {
        let query = supabase
            .from('orders')
            .select('items, restaurant_id, created_at')
            .order('created_at', { ascending: false })
            .limit(10);

        if (userId) {
            query = query.eq('user_id', userId);
        } else if (sessionId) {
            query = query.eq('session_id', sessionId);
        }

        const { data: orders, error } = await query;

        if (error || !orders) return [];

        // Wyciągnij unikalne itemy
        const allItems = orders.flatMap(o => o.items || []);
        const unique = allItems.reduce((acc, item) => {
            const key = item.name || item.id;
            if (!acc[key]) {
                acc[key] = { ...item, orderCount: 1 };
            } else {
                acc[key].orderCount++;
            }
            return acc;
        }, {});

        return Object.values(unique).sort((a, b) => b.orderCount - a.orderCount);

    } catch (err) {
        console.warn('[SmartRec:History] Error:', err.message);
        return [];
    }
}

/**
 * Łączy rekomendacje z walidacją w jedną odpowiedź.
 * 
 * @param {object} params - { restaurantId, text, session }
 * @returns {Promise<{suggestions: array, speech: string}>}
 */
export async function getSmartSuggestions(params) {
    const { restaurantId, text, session } = params;

    // Wykryj preferencje z tekstu
    const preferences = detectUserPreferences(text);

    // Pobierz rekomendacje
    const { recommendations, reason } = await getRestaurantRecommendations(restaurantId, {
        preferences,
        limit: 3
    });

    // Generuj speech
    const speech = generateRecommendationSpeech(recommendations, reason);

    return {
        suggestions: recommendations,
        speech,
        detectedPreferences: preferences
    };
}
