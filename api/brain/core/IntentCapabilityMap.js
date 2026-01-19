/**
 * Intent Capability Map (ICM)
 * ═══════════════════════════════════════════════════════════════════════════
 * Defines FSM rules for each intent: required state, allowed transitions, fallbacks.
 * This is the SINGLE SOURCE OF TRUTH for intent routing rules.
 * 
 * CRITICAL: This file enforces that NO intent can bypass FSM requirements.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const INTENT_CAPS = {
    // ═══════════════════════════════════════════════════════════════════════════
    // DISCOVERY DOMAIN
    // ═══════════════════════════════════════════════════════════════════════════
    find_nearby: {
        domain: 'food',
        requiredState: {},  // No requirements - always allowed
        allowedTransitions: ['select_restaurant', 'show_more_options', 'find_nearby'],
        setsState: [
            'last_location',
            'last_restaurants_list',
            'expectedContext',
            'pendingDish?',
            'currentRestaurant=null',      // 🔥 Discovery resets restaurant context
            'lockedRestaurantId=null'      // 🔥 No locked restaurant during discovery
        ],
        fallbackIntent: null, // Terminal intent
    },

    menu_request: {
        domain: 'food',
        requiredState: { currentRestaurant: 'any' }, // Must have restaurant context
        allowedTransitions: ['create_order', 'select_restaurant'],
        setsState: ['lastMenu'],
        fallbackIntent: 'find_nearby', // If no restaurant, discover first
    },

    show_more_options: {
        domain: 'food',
        requiredState: { last_restaurants_list: 'non_empty' },
        allowedTransitions: ['select_restaurant', 'find_nearby'],
        setsState: [],
        fallbackIntent: 'find_nearby',
    },

    recommend: {
        domain: 'food',
        requiredState: {},
        allowedTransitions: ['find_nearby'],
        setsState: ['expectedContext'],
        fallbackIntent: 'find_nearby',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SELECTION DOMAIN
    // ═══════════════════════════════════════════════════════════════════════════
    select_restaurant: {
        domain: 'food',
        requiredState: { last_restaurants_list: 'non_empty' },
        allowedTransitions: ['menu_request', 'create_order', 'confirm_order'],
        setsState: ['currentRestaurant', 'lockedRestaurantId', 'pendingDish=null'],
        fallbackIntent: 'find_nearby',
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ORDERING DOMAIN (GUARDED)
    // ═══════════════════════════════════════════════════════════════════════════
    create_order: {
        domain: 'ordering',
        requiredState: {
            OR: [
                { currentRestaurant: 'any' },
                { lastRestaurant: 'any' }
            ]
        },
        allowedTransitions: ['confirm_order', 'create_order', 'cancel_order'],
        setsState: ['pendingOrder', 'expectedContext'],
        fallbackIntent: 'find_nearby', // If no restaurant, discover first
        HARD_BLOCK_LEGACY: true, // Cannot be executed from legacy NLU source
        MUTATES_CART: false, // Does NOT mutate cart
    },

    confirm_order: {
        domain: 'ordering',
        requiredState: {
            pendingOrder: 'non_empty',
            expectedContext: 'confirm_order'
        },
        allowedTransitions: ['create_order', 'find_nearby', 'menu_request'],
        setsState: ['cart', 'pendingOrder=null', 'expectedContext=null'],
        fallbackIntent: null, // If requirements not met, ignore
        MUTATES_CART: true, // ⚠️ ONLY INTENT THAT MUTATES CART
    },

    confirm_add_to_cart: {
        domain: 'ordering',
        requiredState: {
            OR: [
                { pendingDish: 'any' },
                { 'entities.dish': 'any' }
            ]
        },
        allowedTransitions: ['create_order', 'confirm_order'],
        setsState: ['pendingDish=null', 'expectedContext'],
        fallbackIntent: 'create_order',
        MUTATES_CART: false, // Does NOT mutate cart - only prepares
    },

    cancel_order: {
        domain: 'ordering',
        requiredState: {},
        allowedTransitions: ['find_nearby', 'menu_request'],
        setsState: ['pendingOrder=null', 'expectedContext=null'],
        fallbackIntent: null,
        MUTATES_CART: false,
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // SYSTEM DOMAIN
    // ═══════════════════════════════════════════════════════════════════════════
    confirm: {
        domain: 'system',
        requiredState: {},
        allowedTransitions: [], // Context-dependent
        setsState: [],
        fallbackIntent: null,
    },

    unknown: {
        domain: 'system',
        requiredState: {},
        allowedTransitions: ['find_nearby'],
        setsState: [],
        fallbackIntent: 'find_nearby',
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate transition between intents
 */
export function validateIntentTransition(fromIntent, toIntent, session) {
    const fromCap = INTENT_CAPS[fromIntent];
    if (!fromCap) return { valid: true }; // Unknown intent, allow

    if (!fromCap.allowedTransitions.includes(toIntent)) {
        return { valid: false, reason: `Transition ${fromIntent} → ${toIntent} not allowed` };
    }
    return { valid: true };
}

/**
 * Check if session state meets intent requirements
 * @returns {{ met: boolean, reason: string | null }}
 */
export function checkRequiredState(intent, session) {
    const cap = INTENT_CAPS[intent];
    if (!cap || !cap.requiredState || Object.keys(cap.requiredState).length === 0) {
        return { met: true, reason: null };
    }

    const reqs = cap.requiredState;

    // Handle OR conditions
    if (reqs.OR) {
        const anyMet = reqs.OR.some(cond => checkSingleCondition(cond, session));
        return { met: anyMet, reason: anyMet ? null : `None of OR conditions met for ${intent}` };
    }

    // Handle AND conditions (default)
    for (const [key, value] of Object.entries(reqs)) {
        if (!checkSingleCondition({ [key]: value }, session)) {
            return { met: false, reason: `Required state ${key}=${value} not met for ${intent}` };
        }
    }
    return { met: true, reason: null };
}

/**
 * Check a single state condition
 */
function checkSingleCondition(cond, session) {
    for (const [key, value] of Object.entries(cond)) {
        const sessionValue = session?.[key];

        if (value === 'any') {
            // Must exist and be truthy
            if (!sessionValue) return false;
        } else if (value === 'non_empty') {
            // Must exist and be non-empty (for arrays/objects)
            if (!sessionValue) return false;
            if (Array.isArray(sessionValue) && sessionValue.length === 0) return false;
            if (typeof sessionValue === 'object' && Object.keys(sessionValue).length === 0) return false;
        } else if (value === 'confirm_order') {
            // Exact match for expectedContext
            if (sessionValue !== 'confirm_order') return false;
        } else {
            // Exact value match
            if (sessionValue !== value) return false;
        }
    }
    return true;
}

/**
 * Get fallback intent when requirements not met
 */
export function getFallbackIntent(intent) {
    return INTENT_CAPS[intent]?.fallbackIntent || 'find_nearby';
}

/**
 * Check if intent is blocked from legacy NLU source
 */
export function isHardBlockedFromLegacy(intent) {
    return INTENT_CAPS[intent]?.HARD_BLOCK_LEGACY === true;
}

/**
 * Check if intent mutates cart (ONLY confirm_order should return true)
 */
export function mutatesCart(intent) {
    return INTENT_CAPS[intent]?.MUTATES_CART === true;
}

/**
 * Get intent domain
 */
export function getIntentDomain(intent) {
    return INTENT_CAPS[intent]?.domain || 'system';
}
