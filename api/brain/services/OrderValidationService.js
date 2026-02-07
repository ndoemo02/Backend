/**
 * OrderValidationService.js
 * ═══════════════════════════════════════════════════════════════════════════
 * CENTRALNA WALIDACJA ZAMÓWIEŃ - "SAFETY NET"
 * 
 * Sprawdza poprawność zamówienia przed:
 * - Dodaniem do koszyka (pendingOrder → cart)
 * - Zapisem do DB (persistOrderToDB)
 * 
 * ZASADA: Lepiej ZAPYTAĆ niż narobić BIGOSU
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '../../_supabase.js';

// ═══════════════════════════════════════════════════════════════════════════
// TYPY BŁĘDÓW WALIDACJI
// ═══════════════════════════════════════════════════════════════════════════
export const VALIDATION_ERROR = {
    EMPTY_CART: 'EMPTY_CART',
    NO_RESTAURANT: 'NO_RESTAURANT',
    RESTAURANT_NOT_FOUND: 'RESTAURANT_NOT_FOUND',
    RESTAURANT_CLOSED: 'RESTAURANT_CLOSED',
    ITEM_NOT_AVAILABLE: 'ITEM_NOT_AVAILABLE',
    ITEM_PRICE_CHANGED: 'ITEM_PRICE_CHANGED',
    MIXED_RESTAURANTS: 'MIXED_RESTAURANTS',
    QUANTITY_TOO_HIGH: 'QUANTITY_TOO_HIGH',
    MIN_ORDER_NOT_MET: 'MIN_ORDER_NOT_MET',
    DELIVERY_UNAVAILABLE: 'DELIVERY_UNAVAILABLE'
};

export const VALIDATION_WARNING = {
    ITEM_PRICE_INCREASED: 'ITEM_PRICE_INCREASED',
    ITEM_RUNNING_LOW: 'ITEM_RUNNING_LOW',
    PEAK_HOURS_DELAY: 'PEAK_HOURS_DELAY',
    DIFFERENT_RESTAURANT_SUGGESTION: 'DIFFERENT_RESTAURANT_SUGGESTION'
};

/**
 * Waliduje pojedynczy item przed dodaniem do koszyka.
 * 
 * @param {object} item - { id, name, price, quantity, restaurant_id }
 * @param {object} context - { currentRestaurantId, session }
 * @returns {Promise<{valid: boolean, errors: array, warnings: array, correctedItem?: object}>}
 */
export async function validateItemBeforeAdd(item, context = {}) {
    const errors = [];
    const warnings = [];
    let correctedItem = { ...item };

    const fnTag = '[OrderValidation:Item]';

    // 1. Podstawowa walidacja
    if (!item.name) {
        errors.push({ code: VALIDATION_ERROR.ITEM_NOT_AVAILABLE, message: 'Brak nazwy produktu' });
        return { valid: false, errors, warnings };
    }

    if (!item.quantity || item.quantity < 1) {
        correctedItem.quantity = 1; // Auto-fix
    }

    if (item.quantity > 50) {
        errors.push({
            code: VALIDATION_ERROR.QUANTITY_TOO_HIGH,
            message: `Zamówienie ${item.quantity}x ${item.name}? To bardzo dużo! Potwierdź, że to poprawna ilość.`,
            suggestedMax: 10
        });
        return { valid: false, errors, warnings };
    }

    // 2. Sprawdź dostępność w bazie (jeśli mamy ID)
    if (item.id) {
        try {
            const { data: dbItem, error } = await supabase
                .from('menu_items_v2')
                .select('id, name, price_pln, is_available, restaurant_id')
                .eq('id', item.id)
                .maybeSingle();

            if (error) {
                console.warn(`${fnTag} DB lookup failed:`, error.message);
                // Nie blokuj - może być problem z bazą, ale zamówienie może być ok
                warnings.push({
                    code: 'DB_CHECK_FAILED',
                    message: 'Nie udało się zweryfikować dostępności w bazie.'
                });
            } else if (!dbItem) {
                errors.push({
                    code: VALIDATION_ERROR.ITEM_NOT_AVAILABLE,
                    message: `Pozycja "${item.name}" nie istnieje już w menu.`
                });
                return { valid: false, errors, warnings };
            } else {
                // Sprawdź dostępność
                if (dbItem.is_available === false) {
                    errors.push({
                        code: VALIDATION_ERROR.ITEM_NOT_AVAILABLE,
                        message: `"${item.name}" jest aktualnie niedostępne. Spróbuj czegoś innego.`
                    });
                    return { valid: false, errors, warnings };
                }

                // Sprawdź czy cena się nie zmieniła
                const dbPrice = parseFloat(dbItem.price_pln);
                const orderPrice = parseFloat(item.price);

                if (!isNaN(dbPrice) && !isNaN(orderPrice) && Math.abs(dbPrice - orderPrice) > 0.01) {
                    const priceDiff = dbPrice - orderPrice;

                    if (priceDiff > 0) {
                        // Cena WZROSŁA - ostrzeż użytkownika
                        warnings.push({
                            code: VALIDATION_WARNING.ITEM_PRICE_INCREASED,
                            message: `Cena "${item.name}" wzrosła do ${dbPrice.toFixed(2)} zł (było ${orderPrice.toFixed(2)} zł).`,
                            oldPrice: orderPrice,
                            newPrice: dbPrice
                        });
                    }
                    // Zawsze używaj aktualnej ceny z bazy
                    correctedItem.price = dbPrice;
                    correctedItem.price_pln = dbPrice;
                }
            }
        } catch (err) {
            console.error(`${fnTag} Unexpected error:`, err.message);
            // Nie blokuj zamówienia przez błąd walidacji
        }
    }

    // 3. Walidacja kontekstu restauracji
    if (context.currentRestaurantId && item.restaurant_id &&
        context.currentRestaurantId !== item.restaurant_id) {
        warnings.push({
            code: VALIDATION_WARNING.DIFFERENT_RESTAURANT_SUGGESTION,
            message: `Uwaga: "${item.name}" jest z innej restauracji niż poprzednie pozycje.`,
            currentRestaurant: context.currentRestaurantId,
            itemRestaurant: item.restaurant_id
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        correctedItem
    };
}

/**
 * Waliduje cały koszyk przed finalizacją.
 * 
 * @param {object} cart - { items: array, total: number, restaurant_id }
 * @param {object} session - Sesja użytkownika
 * @returns {Promise<{valid: boolean, errors: array, warnings: array, correctedCart?: object}>}
 */
export async function validateCartBeforeCheckout(cart, session = {}) {
    const errors = [];
    const warnings = [];
    const fnTag = '[OrderValidation:Cart]';

    if (!cart || !cart.items || cart.items.length === 0) {
        errors.push({
            code: VALIDATION_ERROR.EMPTY_CART,
            message: 'Koszyk jest pusty. Co chcesz zamówić?'
        });
        return { valid: false, errors, warnings };
    }

    // 1. Sprawdź czy wszystkie pozycje są z tej samej restauracji
    const restaurantIds = [...new Set(cart.items.map(i => i.restaurant_id).filter(Boolean))];

    if (restaurantIds.length > 1) {
        errors.push({
            code: VALIDATION_ERROR.MIXED_RESTAURANTS,
            message: 'Masz produkty z różnych restauracji. Zamów osobno z każdej lub usuń wybrane pozycje.',
            restaurants: restaurantIds
        });
        return { valid: false, errors, warnings };
    }

    const restaurantId = restaurantIds[0] || cart.restaurant_id;

    // 2. Sprawdź czy restauracja istnieje i jest otwarta
    if (restaurantId) {
        try {
            const { data: restaurant, error } = await supabase
                .from('restaurants')
                .select('id, name, is_open, min_order_pln, delivery_available')
                .eq('id', restaurantId)
                .maybeSingle();

            if (error || !restaurant) {
                errors.push({
                    code: VALIDATION_ERROR.RESTAURANT_NOT_FOUND,
                    message: 'Nie można zweryfikować restauracji. Spróbuj wybrać ponownie.'
                });
                return { valid: false, errors, warnings };
            }

            if (restaurant.is_open === false) {
                errors.push({
                    code: VALIDATION_ERROR.RESTAURANT_CLOSED,
                    message: `${restaurant.name} jest obecnie zamknięta. Sprawdź godziny otwarcia.`
                });
                return { valid: false, errors, warnings };
            }

            // Sprawdź minimalną wartość zamówienia
            if (restaurant.min_order_pln && cart.total < restaurant.min_order_pln) {
                errors.push({
                    code: VALIDATION_ERROR.MIN_ORDER_NOT_MET,
                    message: `Minimalna kwota zamówienia w ${restaurant.name} to ${restaurant.min_order_pln} zł. Dodaj jeszcze ${(restaurant.min_order_pln - cart.total).toFixed(2)} zł.`,
                    minOrderAmount: restaurant.min_order_pln,
                    currentTotal: cart.total
                });
                return { valid: false, errors, warnings };
            }

        } catch (err) {
            console.warn(`${fnTag} Restaurant check failed:`, err.message);
        }
    }

    // 3. Waliduj każdy item osobno
    let correctedItems = [];
    let cartNeedsCorrection = false;

    for (const item of cart.items) {
        const result = await validateItemBeforeAdd(item, { currentRestaurantId: restaurantId });

        if (!result.valid) {
            errors.push(...result.errors);
        }
        warnings.push(...result.warnings);

        if (result.correctedItem && JSON.stringify(result.correctedItem) !== JSON.stringify(item)) {
            cartNeedsCorrection = true;
        }
        correctedItems.push(result.correctedItem || item);
    }

    // 4. Przelicz sumę jeśli były korekty
    const correctedCart = {
        ...cart,
        items: correctedItems,
        total: correctedItems.reduce((sum, i) => sum + (parseFloat(i.price || i.price_pln || 0) * (i.quantity || i.qty || 1)), 0)
    };

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        correctedCart: cartNeedsCorrection ? correctedCart : cart
    };
}

/**
 * Generuje czytelny komunikat błędu dla użytkownika.
 * 
 * @param {array} errors - Lista błędów z walidacji
 * @returns {string} - Komunikat do TTS/UI
 */
export function formatValidationErrorsForUser(errors) {
    if (!errors || errors.length === 0) return '';

    if (errors.length === 1) {
        return errors[0].message;
    }

    // Wiele błędów - podsumuj
    return `Mam kilka uwag do zamówienia: ${errors.map(e => e.message).join('. ')}`;
}

/**
 * Generuje czytelny komunikat ostrzeżeń dla użytkownika.
 * 
 * @param {array} warnings - Lista ostrzeżeń z walidacji
 * @returns {string} - Komunikat do TTS/UI
 */
export function formatValidationWarningsForUser(warnings) {
    if (!warnings || warnings.length === 0) return '';

    return warnings.map(w => w.message).join(' ');
}
