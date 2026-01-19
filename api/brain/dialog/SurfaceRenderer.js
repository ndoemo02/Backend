/**
 * Dialog Surface Renderer
 * ═══════════════════════════════════════════════════════════════════════════
 * Deterministic template-based reply generation (NO LLM).
 * Transforms structured facts into natural Polish responses.
 * 
 * CRITICAL RULES:
 * ❌ NO LLM calls
 * ❌ Does NOT make decisions
 * ❌ Does NOT mutate session/cart
 * ✅ ONLY transforms provided facts into natural Polish
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * @typedef {'CLARIFY_ITEMS' | 'ITEM_NOT_FOUND' | 'CONFIRM_ADD' | 'CHOOSE_RESTAURANT' | 'ASK_LOCATION' | 'ERROR'} SurfaceKey
 * 
 * @typedef {Object} DialogSurface
 * @property {SurfaceKey} key
 * @property {Object} [facts]
 * @property {string} [facts.restaurantName]
 * @property {string} [facts.city]
 * @property {string[]} [facts.dishNames]
 * @property {number} [facts.priceTotal]
 * @property {string} [facts.currency]
 * @property {Array<{name: string, reason?: string}>} [facts.unknownItems]
 * @property {Array<{base: string, options: {name: string, price?: number}[]}>} [facts.clarify]
 * @property {Array<{id: string, label: string}>} [options]
 * @property {Object} [style]
 * @property {'neutral' | 'friendly'} [style.tone]
 */

/**
 * Polish templates for each surface key
 * Pure functions: (facts) => string
 */
const SURFACE_TEMPLATES = {
    /**
     * ASK_LOCATION: No location known, need to ask
     */
    ASK_LOCATION: (facts) => {
        const dish = facts?.dishNames?.[0];
        if (dish) {
            return `Dobra, szukam "${dish}" — tylko powiedz mi miasto, żebym znalazła restauracje.`;
        }
        return `Dobra — tylko powiedz mi miasto, żebym znalazła restauracje.`;
    },

    /**
     * CHOOSE_RESTAURANT: Multiple restaurants found, user must pick
     */
    CHOOSE_RESTAURANT: (facts) => {
        const city = facts?.city || 'w okolicy';
        const count = facts?.restaurantCount || 'kilka';
        return `Mam ${count} miejsc w ${city}. Którą restaurację wybierasz? (Możesz powiedzieć numer albo nazwę.)`;
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // NEW: Soft Dialog Bridge Keys (KROK 3)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * ASK_RESTAURANT_FOR_MENU: User wants menu but no restaurant selected
     * Shows list of available restaurants to choose from
     */
    ASK_RESTAURANT_FOR_MENU: (facts) => {
        const restaurants = facts?.restaurants || [];
        if (restaurants.length === 0) {
            return `Chcesz zobaczyć menu, ale nie mam jeszcze restauracji. Powiedz gdzie szukać.`;
        }

        const list = restaurants.slice(0, 5).map((r, i) => `${i + 1}. ${r.name}`).join(', ');
        return `Chcesz menu której restauracji? ${list}`;
    },

    /**
     * ASK_RESTAURANT_FOR_ORDER: User wants to order but no restaurant selected
     */
    ASK_RESTAURANT_FOR_ORDER: (facts) => {
        const dish = facts?.dishNames?.[0];
        const restaurants = facts?.restaurants || [];

        if (restaurants.length === 0) {
            return dish
                ? `Chcesz "${dish}", ale nie mam jeszcze restauracji. Powiedz gdzie szukać.`
                : `Chcesz zamówić, ale nie mam jeszcze restauracji. Powiedz gdzie szukać.`;
        }

        const list = restaurants.slice(0, 5).map((r, i) => `${i + 1}. ${r.name}`).join(', ');
        const dishText = dish ? ` "${dish}"` : '';
        return `Chcesz zamówić${dishText} — z której restauracji? ${list}`;
    },

    /**
     * ASK_CLARIFICATION_DISH: Need to clarify which dish variant
     */
    ASK_CLARIFICATION_DISH: (facts) => {
        const dish = facts?.dishNames?.[0] || 'tej pozycji';
        const options = facts?.options || [];

        if (options.length === 0) {
            return `Mam kilka wariantów "${dish}". Który dokładnie?`;
        }

        const list = options.slice(0, 4).map((opt, i) => {
            const price = opt.price ? ` (${opt.price} zł)` : '';
            return `${i + 1}) ${opt.name}${price}`;
        }).join(' ');

        return `Mam kilka opcji dla "${dish}": ${list}. Który?`;
    },

    /**
     * CONFIRM_SELECTED_RESTAURANT: Confirm restaurant selection before proceeding
     */
    CONFIRM_SELECTED_RESTAURANT: (facts) => {
        const name = facts?.restaurantName || 'ta restauracja';
        const action = facts?.nextAction || 'kontynuować';
        return `Czy chodzi o ${name}? Powiedz "tak" żeby ${action}.`;
    },

    /**
     * ITEM_NOT_FOUND: Requested item not in menu
     */
    ITEM_NOT_FOUND: (facts) => {
        const unknown = facts?.unknownItems?.[0]?.name || 'tej pozycji';
        const restaurant = facts?.restaurantName || 'menu';
        return `Nie widzę "${unknown}" w ${restaurant}. Podaj pełną nazwę z karty albo powiedz: "pokaż menu".`;
    },

    /**
     * ITEM_UNAVAILABLE: Item exists but is out of stock/unavailable
     */
    ITEM_UNAVAILABLE: (facts) => {
        const item = facts?.itemName || 'ta pozycja';
        return `Niestety "${item}" jest teraz niedostępne.`;
    },

    /**
     * CLARIFY_ITEMS: Disambiguation needed - multiple options for same base item
     */
    CLARIFY_ITEMS: (facts) => {
        const clarify = facts?.clarify?.[0];
        if (!clarify) {
            return `Mam kilka opcji do wyboru. Którą wybierasz?`;
        }

        const base = clarify.base || 'pozycji';
        const options = clarify.options || [];

        if (options.length === 0) {
            return `Mam kilka wariantów "${base}". Który wybierasz?`;
        }

        // Build numbered list
        const optionsList = options.slice(0, 4).map((opt, i) => {
            const price = opt.price ? ` (${opt.price} zł)` : '';
            return `${i + 1}) ${opt.name}${price}`;
        }).join(' ');

        return `Mam kilka opcji dla "${base}". Wybierz: ${optionsList}`;
    },

    /**
     * CONFIRM_ADD: Confirm adding items to cart
     */
    CONFIRM_ADD: (facts) => {
        const dishes = facts?.dishNames || [];
        const total = facts?.priceTotal || 0;
        const currency = facts?.currency || 'zł';

        if (dishes.length === 0) {
            return `Dodać do koszyka? Powiedz: "tak" albo "nie".`;
        }

        const dishList = dishes.slice(0, 3).join(', ');
        const priceText = total > 0 ? ` za ${total} ${currency}` : '';

        return `Dodać do koszyka: ${dishList}${priceText}? Powiedz: "tak" albo "nie".`;
    },

    /**
     * CART_EMPTY: User tries to checkout/confirm with empty cart
     */
    CART_EMPTY: (facts) => {
        return `Twój koszyk jest pusty. Co dodać?`;
    },

    /**
     * ASK_WHAT_TO_ORDER: User said "order" but implied no items
     */
    ASK_WHAT_TO_ORDER: (facts) => {
        return `Co dokładnie chciałbyś zamówić?`;
    },

    /**
     * CONFIRM_IMPLICIT_ORDER: Intent create_order but no explicit ordering verb
     */
    CONFIRM_IMPLICIT_ORDER: (facts) => {
        const item = facts?.itemName || 'to';
        return `Czy chcesz zamówić ${item}?`;
    },

    /**
     * LEGACY_ORDER_BLOCKED: Legacy intent blocked for safety
     */
    LEGACY_ORDER_BLOCKED: (facts) => {
        return `Aby złożyć zamówienie, najpierw znajdźmy restaurację. Na co masz ochotę?`;
    },

    /**
     * ASK_LOCATION_CLARIFY: Location not recognized
     */
    ASK_LOCATION_CLARIFY: (facts) => {
        const loc = facts?.location || 'to miejsce';
        return `Nie znam "${loc}". Czy to na pewno poprawna nazwa miasta?`;
    },

    /**
     * CART_MUTATION_BLOCKED: Illegal cart mutation attempt
     */
    CART_MUTATION_BLOCKED: (facts) => {
        return `Dokończmy najpierw obecny krok zamówienia.`;
    },

    /**
     * ERROR: Generic error fallback
     */
    ERROR: (facts) => {
        const reason = facts?.reason;
        if (reason === 'timeout') {
            return `Przepraszam, trwa to zbyt długo. Spróbuj ponownie.`;
        }
        if (reason === 'no_menu') {
            return `Nie mam dostępu do menu tej restauracji. Spróbuj innej.`;
        }
        return `Przepraszam, coś poszło nie tak. Spróbuj ponownie.`;
    }
};

/**
 * Render a dialog surface to natural Polish reply
 * 
 * @param {DialogSurface} surface - Surface input object
 * @returns {{ reply: string, uiHints?: { surfaceKey: string, options?: Array<{id: string, label: string}> } }}
 */
export function renderSurface(surface) {
    // Validate input
    if (!surface || typeof surface !== 'object') {
        return {
            reply: SURFACE_TEMPLATES.ERROR({}),
            uiHints: { surfaceKey: 'ERROR' }
        };
    }

    const { key, facts = {}, options = [], style = {} } = surface;

    // Get template
    const template = SURFACE_TEMPLATES[key];

    let reply;
    if (template) {
        try {
            reply = template(facts);
        } catch (err) {
            console.warn(`[SurfaceRenderer] Template error for ${key}:`, err.message);
            reply = SURFACE_TEMPLATES.ERROR(facts);
        }
    } else {
        console.warn(`[SurfaceRenderer] Unknown surface key: ${key}`);
        reply = SURFACE_TEMPLATES.ERROR(facts);
    }

    // Apply tone if specified (minimal modification)
    if (style?.tone === 'friendly' && !reply.startsWith('Przepraszam')) {
        // Already friendly by default
    }

    // Build UI hints
    const uiHints = {
        surfaceKey: key || 'ERROR'
    };

    if (options && options.length > 0) {
        uiHints.options = options;
    }

    return { reply, uiHints };
}

/**
 * Detect surface key from handler result
 * Returns surface object if actionable, null otherwise
 * 
 * @param {Object} handlerResult - Result from domain handler
 * @param {Object} context - Pipeline context (session, entities)
 * @returns {DialogSurface | null}
 */
export function detectSurface(handlerResult, context = {}) {
    if (!handlerResult) return null;

    const session = context.session || {};
    const entities = context.entities || {};

    // Case A: Disambiguation needed (clarify list)
    if (handlerResult.needsClarification ||
        (handlerResult.clarify && handlerResult.clarify.length > 0)) {
        return {
            key: 'CLARIFY_ITEMS',
            facts: {
                restaurantName: handlerResult.restaurantName || session.currentRestaurant?.name,
                clarify: handlerResult.clarify || []
            },
            options: handlerResult.clarify?.[0]?.options?.map((opt, i) => ({
                id: opt.id || String(i + 1),
                label: opt.name
            })) || []
        };
    }

    // Case B: Unknown items detected
    if (handlerResult.unknownItems && handlerResult.unknownItems.length > 0) {
        return {
            key: 'ITEM_NOT_FOUND',
            facts: {
                restaurantName: session.currentRestaurant?.name || handlerResult.restaurantName,
                unknownItems: handlerResult.unknownItems
            }
        };
    }

    // Case C: No location, need to ask
    if (handlerResult.needsLocation ||
        session.awaiting === 'location' ||
        session.expectedContext === 'find_nearby_ask_location') {
        return {
            key: 'ASK_LOCATION',
            facts: {
                dishNames: entities.dish ? [entities.dish] : (session.pendingDish ? [session.pendingDish] : [])
            }
        };
    }

    // Case D: Multiple restaurants, need selection
    if (handlerResult.restaurants && handlerResult.restaurants.length > 1 &&
        session.expectedContext === 'select_restaurant') {
        return {
            key: 'CHOOSE_RESTAURANT',
            facts: {
                city: session.last_location || entities.location,
                restaurantCount: handlerResult.restaurants.length
            },
            options: handlerResult.restaurants.slice(0, 5).map((r, i) => ({
                id: r.id || String(i + 1),
                label: r.name
            }))
        };
    }

    // Case E: Confirm add to cart
    if (session.expectedContext === 'confirm_order' && handlerResult.pendingOrder) {
        const items = handlerResult.pendingOrder.items || [];
        return {
            key: 'CONFIRM_ADD',
            facts: {
                dishNames: items.map(i => i.name),
                priceTotal: parseFloat(handlerResult.pendingOrder.total) || 0,
                currency: 'zł',
                restaurantName: handlerResult.pendingOrder.restaurant || session.currentRestaurant?.name
            }
        };
    }

    // No actionable surface detected
    return null;
}

/**
 * Get all available surface keys
 * @returns {string[]}
 */
export function getSurfaceKeys() {
    return Object.keys(SURFACE_TEMPLATES);
}

/**
 * Check if surface key exists
 * @param {string} key
 * @returns {boolean}
 */
export function hasSurfaceKey(key) {
    return key in SURFACE_TEMPLATES;
}
