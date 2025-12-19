
import { fuzzyMatch } from "../helpers.js";

export function validateOrderItem(itemCandidate, restaurantMenu) {
    // 1. Try exact or fuzzy match
    let matched = restaurantMenu.find(m =>
        (m.name || '').toLowerCase() === (itemCandidate.name || '').toLowerCase()
    );

    // TEMPORARY: FUZZY MATCH ENABLED
    if (!matched) {
        matched = restaurantMenu.find(m => fuzzyMatch(itemCandidate.name, m.name));
    }

    if (!matched) {
        // Suggest alternatives
        const suggestions = restaurantMenu
            // .filter(m => fuzzyMatch(itemCandidate.name, m.name, 5)) // looser threshold for suggestions
            .slice(0, 3)
            .map(m => m.name);

        return {
            ok: false,
            reason: 'not_found',
            message: `Nie znalazłem pozycji "${itemCandidate.name}" w menu.`,
            suggestions
        };
    }

    // 2. Validate Size Validity (if menu defines sizes)
    if (matched.sizes && Array.isArray(matched.sizes)) {
        // If size is provided but not in list
        if (itemCandidate.size && !matched.sizes.includes(itemCandidate.size)) {
            return {
                ok: false,
                reason: 'invalid_size',
                message: `Rozmiar "${itemCandidate.size}" niedostępny. Dostępne: ${matched.sizes.join(', ')}.`,
                suggestions: matched.sizes
            };
        }
    }

    // 3. Check if size is missing (Pizza heuristic)
    const isPizza = (matched.category || '').toLowerCase().includes('pizza') ||
        (matched.name || '').toLowerCase().includes('pizza');

    // Check if user provided size in candidate or if we normalized it
    const hasSize = !!itemCandidate.size;

    if (isPizza && !hasSize) {
        return {
            ok: false,
            reason: 'missing_size',
            message: `Jaki rozmiar pizzy "${matched.name}" wybierasz?`,
            item: matched,
            suggestions: matched.sizes || ['mała', 'średnia', 'duża']
        };
    }

    // 3. Success
    return {
        ok: true,
        item: {
            ...matched,
            // Override with order specifics
            quantity: itemCandidate.quantity || 1,
            selectedSize: itemCandidate.size || (isPizza ? null : 'standard'), // standard if not pizza
            selectedExtras: itemCandidate.extras || []
        }
    };
}
