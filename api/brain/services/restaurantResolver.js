/**
 * restaurantResolver.js
 *
 * Shared helper: resolve a restaurant name string → {id, name} object.
 * Used by SelectRestaurantHandler and OrderHandler to handle the case where
 * Gemini/NLU provides restaurant_name but not restaurant_id. Also backs the
 * public GET /api/restaurants/resolve endpoint (api/restaurants/resolve.js).
 *
 * Resolution order:
 *  1. Entity cache  — restaurants shown to user recently, no DB call
 *  2. DB fallback   — ilike query on restaurants.name
 *  3. DB fallback   — ilike query on restaurants.aliases
 *
 * Step 3 reads the `aliases` column exclusively through the service_role
 * client (`../../_supabase.js`) and never includes it in a `.select()` list —
 * the column is not part of the Stage10 anon/authenticated grant and must
 * stay backend-only (see supabase/migrations/20260808000400_stage10_public_catalog_rls.sql).
 */

import { normalizeDish } from '../helpers.js';

/**
 * @param {string} name - Restaurant name to resolve
 * @param {Array<{id: string, name: string}>} entityCacheRestaurants - From session.entityCache.restaurants
 * @returns {Promise<{id: string, name: string} | null>}
 */
export async function resolveRestaurantByName(name, entityCacheRestaurants = []) {
    if (!name) return null;
    const normalized = normalizeDish(name);

    // 1. Entity cache — restaurants the user has seen recently
    if (Array.isArray(entityCacheRestaurants) && entityCacheRestaurants.length > 0) {
        const hit = entityCacheRestaurants.find(r => {
            const rName = normalizeDish(r.name || '');
            return rName === normalized || rName.includes(normalized) || normalized.includes(rName);
        });
        if (hit?.id) {
            console.log(`[RESTAURANT_RESOLVE] cache hit: "${hit.name}" (id=${hit.id})`);
            return { id: hit.id, name: hit.name };
        }
    }

    // 2. DB fallback — match against name
    try {
        const { supabase } = await import('../../_supabase.js');
        const { data } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('is_active', true)
            .ilike('name', `%${name}%`)
            .limit(3);

        if (data && data.length > 0) {
            const sorted = [...data].sort((a, b) => a.name.length - b.name.length);
            const best = sorted[0];
            console.log(`[RESTAURANT_RESOLVE] db hit: "${best.name}" (id=${best.id})`);
            return { id: best.id, name: best.name };
        }
    } catch (err) {
        console.warn('[RESTAURANT_RESOLVE] db error:', err?.message);
    }

    // 3. DB fallback — match against aliases (service_role only; `aliases` is
    // deliberately excluded from `.select()` so it can never end up in the
    // returned shape, regardless of what a caller does with the result).
    try {
        const { supabase } = await import('../../_supabase.js');
        const { data } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('is_active', true)
            .ilike('aliases', `%${name}%`)
            .limit(3);

        if (data && data.length > 0) {
            const sorted = [...data].sort((a, b) => a.name.length - b.name.length);
            const best = sorted[0];
            console.log(`[RESTAURANT_RESOLVE] alias hit: "${best.name}" (id=${best.id})`);
            return { id: best.id, name: best.name };
        }
    } catch (err) {
        console.warn('[RESTAURANT_RESOLVE] alias db error:', err?.message);
    }

    console.log(`[RESTAURANT_RESOLVE] unresolved: "${name}"`);
    return null;
}
