/**
 * ConversationGuards.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Context-aware helpers for UX conversation improvements.
 * These guards are ADDITIVE and do NOT modify existing safety layers.
 * 
 * SAFETY LAYERS PRESERVED:
 * - ICM Gate
 * - Cart Mutation Guard  
 * - Grounding (Supabase truth)
 * - SurfaceRenderer templates
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { BrainLogger } from '../../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: CONTEXT-AWARE LEGACY UNLOCK
// Checks if restaurant context is locked (user already selected restaurant)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if user has a locked restaurant context
 * @param {Object} session - Current session object
 * @returns {boolean} - True if restaurant context exists
 */
export function hasLockedRestaurant(session) {
    return !!(
        session?.currentRestaurant ||
        session?.lockedRestaurantId ||
        session?.lastRestaurant ||
        session?.entityCache?.restaurants?.length
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: CONVERSATION CONTINUITY GUARD
// Detects if user is in ordering context (should not reset to discovery)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if session is in ordering context
 * @param {Object} session - Current session object
 * @returns {boolean} - True if in ordering context
 */
export function isOrderingContext(session) {
    return !!(
        session?.currentRestaurant ||
        session?.lastRestaurant ||
        session?.lastIntent === 'select_restaurant' ||
        session?.lastIntent === 'menu_request' ||
        session?.lastIntent === 'create_order' ||
        session?.conversationPhase === 'restaurant_selected' ||
        session?.conversationPhase === 'ordering'
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 5: DISH PHRASE DETECTOR (LIGHT HEURISTIC)
// Detects if user is talking about a dish (not discovery)
// ═══════════════════════════════════════════════════════════════════════════

const DISH_KEYWORDS = [
    // Polish dishes
    'naleśnik', 'nalesnik', 'naleśniki',
    'pierogi', 'pierog',
    'schabowy', 'schabowego',
    'bigos', 'bigosu',
    'żurek', 'zurek',
    'barszcz', 'barszczu',
    'kotlet', 'kotleta',
    // International
    'pizza', 'pizze', 'pizzy',
    'kebab', 'kebaba', 'kebabu',
    'burger', 'burgera', 'burgery',
    'sushi', 'sashimi',
    'makaron', 'makaronu', 'pasta',
    'sałatka', 'salatka', 'sałatki',
    'zupa', 'zupy', 'zupę',
    'frytki', 'frytek',
    'kurczak', 'kurczaka',
    'ryba', 'ryby', 'rybę',
    'stek', 'steka', 'steak',
    // Generic
    'danie', 'dania',
    'posiłek', 'posilek',
    'jedzenie'
];

/**
 * Check if text contains dish-like phrases
 * @param {string} text - User input text
 * @returns {boolean} - True if dish phrase detected
 */
export function containsDishLikePhrase(text) {
    if (!text) return false;

    // Normalize: lowercase, remove diacritics
    const normalized = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    return DISH_KEYWORDS.some(keyword => {
        const keywordNorm = keyword
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        return normalized.includes(keywordNorm);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: RESTAURANT SEMANTIC RECOVERY
// Recovers restaurant from full text when NLU missed the entity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recover restaurant entity from full text using semantic matching
 * @param {string} text - User input text
 * @param {Array} restaurants - List of restaurants from entity cache
 * @returns {Object|null} - Matched restaurant or null
 */
export async function recoverRestaurantFromFullText(text, restaurants) {
    if (!text || !restaurants?.length) return null;

    // Normalize input text
    const normalized = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    // Try exact substring match first
    for (const restaurant of restaurants) {
        if (!restaurant?.name) continue;

        const nameNorm = restaurant.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        // Check if restaurant name appears in text
        if (normalized.includes(nameNorm)) {
            BrainLogger.nlu?.(`🧠 SEMANTIC_RESTAURANT_RECOVERY: Exact match "${restaurant.name}"`);
            return restaurant;
        }

        // Check if significant tokens match (at least 2 consecutive words)
        const nameTokens = nameNorm.split(/\s+/).filter(t => t.length > 2);
        const textTokens = normalized.split(/\s+/);

        // Check for multi-word match
        for (let i = 0; i < textTokens.length - 1; i++) {
            const twoWordPhrase = `${textTokens[i]} ${textTokens[i + 1]}`;
            if (nameTokens.length >= 2) {
                const nameTwoWord = `${nameTokens[0]} ${nameTokens[1]}`;
                if (twoWordPhrase.includes(nameTwoWord) || nameTwoWord.includes(twoWordPhrase)) {
                    BrainLogger.nlu?.(`🧠 SEMANTIC_RESTAURANT_RECOVERY: Token match "${restaurant.name}"`);
                    return restaurant;
                }
            }
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 4: PHASE CALCULATION
// Calculate next conversation phase based on intent
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate the next conversation phase based on intent
 * @param {string} intent - Current intent
 * @param {string} currentPhase - Current phase
 * @param {string} source - Intent source
 * @returns {string} - New phase
 */
export function calculatePhase(intent, currentPhase = 'discovery', source = '') {
    // Phase transitions
    if (intent === 'select_restaurant') return 'restaurant_selected';
    if (intent === 'menu_request') return 'restaurant_selected';
    if (intent === 'create_order') return 'ordering';
    if (intent === 'confirm_order') return 'ordering';
    if (intent === 'confirm_add_to_cart') return 'ordering';

    // find_nearby resets phase UNLESS it came from continuity guard
    if (intent === 'find_nearby' && source !== 'continuity_guard') {
        return 'discovery';
    }

    // Keep current phase for other intents
    return currentPhase;
}

export default {
    hasLockedRestaurant,
    isOrderingContext,
    containsDishLikePhrase,
    recoverRestaurantFromFullText,
    calculatePhase
};
