/**
 * EntityCache.js
 * 
 * Entity Reference Cache for Voice Dialog
 * 
 * Purpose: Store last referenced entities for resolution
 * Enables: "that one", "the second option", "the pizza from before"
 * 
 * ❌ Does NOT influence FSM decisions
 * ✅ Read-only for FSM
 * ✅ Stores restaurants, menu items, positions
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RESTAURANTS = 10;
const MAX_ITEMS = 20;

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restaurant entity structure
 * @typedef {Object} CachedRestaurant
 * @property {string} id - Restaurant UUID
 * @property {string} name - Restaurant name
 * @property {number} position - Position in last shown list (1-indexed)
 * @property {number} timestamp - When cached
 */

/**
 * Menu item entity structure
 * @typedef {Object} CachedItem
 * @property {string} id - Item UUID
 * @property {string} name - Item name
 * @property {string} [restaurantId] - Associated restaurant
 * @property {number} [position] - Position in menu/list
 * @property {number} timestamp - When cached
 */

/**
 * Initialize entity cache on session if not exists
 * @param {Object} session - Session object (mutable)
 */
export function initEntityCache(session) {
    if (!session.entityCache) {
        session.entityCache = {
            restaurants: [],
            items: [],
            lastListType: null // 'restaurants' | 'items' | null
        };
    }
}

/**
 * Cache a list of restaurants (from search/list response)
 * @param {Object} session - Session object (mutable)
 * @param {Array<{id: string, name: string}>} restaurants - Restaurants to cache
 */
export function cacheRestaurants(session, restaurants) {
    initEntityCache(session);

    const timestamp = Date.now();

    session.entityCache.restaurants = restaurants.slice(0, MAX_RESTAURANTS).map((r, idx) => ({
        id: r.id,
        name: r.name,
        position: idx + 1, // 1-indexed
        timestamp
    }));

    session.entityCache.lastListType = 'restaurants';
}

/**
 * Cache a list of menu items (from menu response)
 * @param {Object} session - Session object (mutable)
 * @param {Array<{id: string, name: string}>} items - Items to cache
 * @param {string} [restaurantId] - Associated restaurant
 */
export function cacheItems(session, items, restaurantId = null) {
    initEntityCache(session);

    const timestamp = Date.now();

    session.entityCache.items = items.slice(0, MAX_ITEMS).map((item, idx) => ({
        id: item.id,
        name: item.name,
        restaurantId,
        position: idx + 1, // 1-indexed
        timestamp
    }));

    session.entityCache.lastListType = 'items';
}

/**
 * Resolve a positional reference like "the second one", "1", "pierwsza"
 * @param {Object} session - Session object
 * @param {number|string} position - Position (number or Polish ordinal)
 * @returns {{ type: string, entity: Object } | null}
 */
export function resolvePosition(session, position) {
    initEntityCache(session);

    // Convert position to number
    let posNum = parsePosition(position);
    if (posNum === null) return null;

    const cache = session.entityCache;

    // Use last shown list type to determine which cache to search
    if (cache.lastListType === 'restaurants') {
        const restaurant = cache.restaurants.find(r => r.position === posNum);
        if (restaurant) {
            return { type: 'restaurant', entity: restaurant };
        }
    } else if (cache.lastListType === 'items') {
        const item = cache.items.find(i => i.position === posNum);
        if (item) {
            return { type: 'item', entity: item };
        }
    }

    // Fallback: search both caches
    const restaurant = cache.restaurants.find(r => r.position === posNum);
    if (restaurant) {
        return { type: 'restaurant', entity: restaurant };
    }

    const item = cache.items.find(i => i.position === posNum);
    if (item) {
        return { type: 'item', entity: item };
    }

    return null;
}

/**
 * Resolve "that one" / "ta" / "tamta" - returns last single entity shown
 * @param {Object} session - Session object
 * @returns {{ type: string, entity: Object } | null}
 */
export function resolveDeictic(session) {
    initEntityCache(session);

    const cache = session.entityCache;

    // If last list had exactly one item, return it
    if (cache.lastListType === 'restaurants' && cache.restaurants.length === 1) {
        return { type: 'restaurant', entity: cache.restaurants[0] };
    }
    if (cache.lastListType === 'items' && cache.items.length === 1) {
        return { type: 'item', entity: cache.items[0] };
    }

    // Otherwise, return the most recent single entity mentioned
    // (Would need turn buffer integration for more complex resolution)
    return null;
}

/**
 * Get cached restaurant by name (fuzzy match)
 * @param {Object} session - Session object
 * @param {string} name - Restaurant name to find
 * @returns {CachedRestaurant | null}
 */
export function getRestaurantByName(session, name) {
    initEntityCache(session);

    const normalized = name.toLowerCase().trim();

    return session.entityCache.restaurants.find(r =>
        r.name.toLowerCase().includes(normalized) ||
        normalized.includes(r.name.toLowerCase())
    ) || null;
}

/**
 * Get cached item by name (fuzzy match)
 * @param {Object} session - Session object
 * @param {string} name - Item name to find
 * @returns {CachedItem | null}
 */
export function getItemByName(session, name) {
    initEntityCache(session);

    const normalized = name.toLowerCase().trim();

    return session.entityCache.items.find(item =>
        item.name.toLowerCase().includes(normalized) ||
        normalized.includes(item.name.toLowerCase())
    ) || null;
}

/**
 * Get all cached restaurants (read-only)
 * @param {Object} session - Session object
 * @returns {CachedRestaurant[]}
 */
export function getCachedRestaurants(session) {
    initEntityCache(session);
    return [...session.entityCache.restaurants];
}

/**
 * Get all cached items (read-only)
 * @param {Object} session - Session object
 * @returns {CachedItem[]}
 */
export function getCachedItems(session) {
    initEntityCache(session);
    return [...session.entityCache.items];
}

/**
 * Clear entity cache
 * @param {Object} session - Session object (mutable)
 */
export function clearEntityCache(session) {
    session.entityCache = {
        restaurants: [],
        items: [],
        lastListType: null
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse position from number or Polish ordinal
 * @param {number|string} position - Position input
 * @returns {number | null}
 */
function parsePosition(position) {
    if (typeof position === 'number') {
        return position;
    }

    if (typeof position !== 'string') {
        return null;
    }

    const normalized = position.toLowerCase().trim();

    // Direct number
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num > 0) {
        return num;
    }

    // Polish ordinals
    const ordinals = {
        'pierwsz': 1, 'pierwsza': 1, 'pierwszy': 1, 'pierwsze': 1,
        'drug': 2, 'druga': 2, 'drugi': 2, 'drugie': 2,
        'trzeci': 3, 'trzecia': 3, 'trzecie': 3,
        'czwart': 4, 'czwarta': 4, 'czwarty': 4, 'czwarte': 4,
        'piąt': 5, 'piąta': 5, 'piąty': 5, 'piąte': 5,
        'szóst': 6, 'szósta': 6, 'szósty': 6, 'szóste': 6,
        'siódm': 7, 'siódma': 7, 'siódmy': 7, 'siódme': 7,
        'ósm': 8, 'ósma': 8, 'ósmy': 8, 'ósme': 8,
        'dziewiąt': 9, 'dziewiąta': 9, 'dziewiąty': 9, 'dziewiąte': 9,
        'dziesiąt': 10, 'dziesiąta': 10, 'dziesiąty': 10, 'dziesiąte': 10
    };

    for (const [key, value] of Object.entries(ordinals)) {
        if (normalized.startsWith(key)) {
            return value;
        }
    }

    return null;
}
