/**
 * Intent Schema - LLM Output Validation
 * ═══════════════════════════════════════════════════════════════════════════
 * Manual validation (no Zod dependency) for LLM translator output.
 * 
 * CRITICAL RULES:
 * - LLM CANNOT output IDs
 * - LLM CANNOT output session mutations
 * - LLM CANNOT output actions or cart data
 * - LLM CANNOT output reply text
 * - LLM CAN ONLY output: { intent, confidence, entities }
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ALLOWED_INTENTS = [
    // Discovery Domain
    'find_nearby',
    'menu_request',
    'show_more_options',
    'recommend',

    // Selection Domain
    'select_restaurant',

    // Ordering Domain (GUARDED - LLM can suggest but ICM will block if invalid)
    'create_order',
    'confirm_order',
    'confirm_add_to_cart',
    'cancel_order',

    // System
    'confirm',
    'unknown'
];

/**
 * FORBIDDEN FIELDS - These MUST NEVER appear in LLM output
 * If LLM tries to output these, they will be stripped by sanitizer
 */
export const FORBIDDEN_FIELDS = [
    // Session mutations (LLM has no access to session)
    'sessionId',
    'pendingDish',
    'pendingOrder',
    'awaiting',
    'expectedContext',
    'currentRestaurant',
    'lastRestaurant',
    'last_location',
    'last_restaurants_list',
    'lockedRestaurantId',

    // Database IDs (LLM cannot know IDs - only DisambiguationService can resolve)
    'restaurantId',
    'restaurant_id',
    'menuItemId',
    'menu_item_id',
    'orderId',
    'order_id',
    'id',

    // Cart/Order mutations (only confirm_order can touch cart)
    'cart',
    'items',
    'price',
    'price_pln',
    'total',
    'total_cents',

    // Actions (handlers emit actions, not LLM)
    'actions',
    'contextUpdates',

    // Response fields (pipeline generates these)
    'reply',
    'text',
    'should_reply',
    'audioContent',
    'tts_text',
    'meta'
];

/**
 * Validate LLM output structure
 * @param {object} raw - Parsed JSON from LLM
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLLMOutput(raw) {
    const errors = [];

    // 1. Must be object
    if (typeof raw !== 'object' || raw === null) {
        return { valid: false, errors: ['Output must be an object'] };
    }

    // 2. Intent must be valid enum
    if (!raw.intent || !ALLOWED_INTENTS.includes(raw.intent)) {
        errors.push(`Invalid intent: "${raw.intent}". Allowed: ${ALLOWED_INTENTS.join(', ')}`);
    }

    // 3. Confidence must be 0-1
    if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
        errors.push(`Invalid confidence: ${raw.confidence}. Must be number 0-1.`);
    }

    // 4. Check for forbidden fields at root level
    for (const field of FORBIDDEN_FIELDS) {
        if (field in raw) {
            errors.push(`Forbidden field at root: ${field}`);
        }
    }

    // 5. Check for forbidden fields in entities
    if (raw.entities && typeof raw.entities === 'object') {
        for (const field of FORBIDDEN_FIELDS) {
            if (field in raw.entities) {
                errors.push(`Forbidden field in entities: ${field}`);
            }
        }

        // Validate entity field types
        if (raw.entities.location !== undefined && raw.entities.location !== null) {
            if (typeof raw.entities.location !== 'string') {
                errors.push('entities.location must be string or null');
            }
        }
        if (raw.entities.restaurant !== undefined && raw.entities.restaurant !== null) {
            if (typeof raw.entities.restaurant !== 'string') {
                errors.push('entities.restaurant must be string or null');
            }
        }
        if (raw.entities.dish !== undefined && raw.entities.dish !== null) {
            if (typeof raw.entities.dish !== 'string') {
                errors.push('entities.dish must be string or null');
            }
        }
        if (raw.entities.cuisine !== undefined && raw.entities.cuisine !== null) {
            if (typeof raw.entities.cuisine !== 'string') {
                errors.push('entities.cuisine must be string or null');
            }
        }
        if (raw.entities.quantity !== undefined && raw.entities.quantity !== null) {
            if (!Number.isInteger(raw.entities.quantity) || raw.entities.quantity < 1 || raw.entities.quantity > 99) {
                errors.push('entities.quantity must be integer 1-99 or null');
            }
        }
        if (raw.entities.selectionIndex !== undefined && raw.entities.selectionIndex !== null) {
            if (!Number.isInteger(raw.entities.selectionIndex) || raw.entities.selectionIndex < 1 || raw.entities.selectionIndex > 20) {
                errors.push('entities.selectionIndex must be integer 1-20 or null');
            }
        }
    } else if (raw.entities !== undefined && raw.entities !== null) {
        errors.push('entities must be object or null');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Sanitize LLM output - strip dangerous fields, cap values, ensure safety
 * @param {object} raw - Validated (but potentially dangerous) LLM output
 * @returns {{ intent: string, confidence: number, entities: object }}
 */
export function sanitizeLLMOutput(raw) {
    // 1. Sanitize intent
    const intent = ALLOWED_INTENTS.includes(raw.intent) ? raw.intent : 'unknown';

    // 2. Sanitize confidence (cap at 0.95 - LLM should never be 100% confident)
    const confidence = Math.min(Math.max(Number(raw.confidence) || 0, 0), 0.95);

    // 3. Sanitize entities
    const entities = {};

    if (raw.entities && typeof raw.entities === 'object') {
        // Location - string, max 100 chars
        if (typeof raw.entities.location === 'string' && raw.entities.location.trim()) {
            entities.location = raw.entities.location.trim().slice(0, 100);
        } else {
            entities.location = null;
        }

        // Restaurant - string, max 100 chars (NAME only, never ID)
        if (typeof raw.entities.restaurant === 'string' && raw.entities.restaurant.trim()) {
            entities.restaurant = raw.entities.restaurant.trim().slice(0, 100);
        } else {
            entities.restaurant = null;
        }

        // Dish - string, max 100 chars
        if (typeof raw.entities.dish === 'string' && raw.entities.dish.trim()) {
            entities.dish = raw.entities.dish.trim().slice(0, 100);
        } else {
            entities.dish = null;
        }

        // Cuisine - string, max 50 chars
        if (typeof raw.entities.cuisine === 'string' && raw.entities.cuisine.trim()) {
            entities.cuisine = raw.entities.cuisine.trim().slice(0, 50);
        } else {
            entities.cuisine = null;
        }

        // Quantity - integer 1-99
        if (Number.isInteger(raw.entities.quantity)) {
            entities.quantity = Math.min(Math.max(raw.entities.quantity, 1), 99);
        } else {
            entities.quantity = null;
        }

        // SelectionIndex - integer 1-20 (for "wybierz 2")
        if (Number.isInteger(raw.entities.selectionIndex)) {
            entities.selectionIndex = Math.min(Math.max(raw.entities.selectionIndex, 1), 20);
        } else {
            entities.selectionIndex = null;
        }
    }

    return { intent, confidence, entities };
}
