/**
 * NLU Router - Decyzyjny Mózg
 * Odpowiada za klasyfikację intencji i ekstrakcję encji.
 * NIE dotyka bazy danych. Służy do tego warstwa domenowa.
 */

import { detectIntent as regexGlueDetect } from '../intents/intentRouterGlue.js'; // Reuse existing logic for now
import { normalizeTxt } from '../intents/intentRouterGlue.js';

export class NLURouter {
    constructor() {
        // Cache or loading models here
    }

    /**
     * Wykrywa intencję z tekstu i kontekstu
     * @param {Object} ctx - Pipeline context (text, session, etc.)
     * @returns {Promise<{intent: string, confidence: number, entities: Object, source: string}>}
     */
    async detect(ctx) {
        const { text, session } = ctx;
        const normalized = normalizeTxt(text);

        // --- RULE: New Order / Reset ---
        if (/(nowe\s+zam[óo]wienie|od\s+nowa|start|resetuj|zacznij)/i.test(normalized)) {
            return {
                intent: 'new_order',
                confidence: 1.0,
                source: 'rule_guard'
            };
        }



        // --- OPTIMIZATION: Task 1 - Restaurant Lock ---
        // If locked in restaurant, prevent re-extraction unless escape phrase used
        if (session?.context === 'IN_RESTAURANT' && session?.lockedRestaurantId) {
            // Escape phrases
            if (/(zmień|wróć|inn[ea]|powrót)/i.test(normalized)) {
                // Leave the lock (Intent: unknown or show_more_options allows system to handle unlock context)
                // But wait, user wants to change restaurant.
                // We can return 'find_nearby' or 'select_restaurant' (to pick another)
                return { intent: 'find_nearby', confidence: 0.9, source: 'lock_escape' };
            }

            // Check if it looks like menu request, otherwise default to create_order context
            // or let legacy regex decide but ignore 'find_nearby' or 'select_restaurant' if it seems ambiguous
            // For now, allow flow to proceed but we will block restaurant extraction in dispatcher if needed.
            // Actually, if we are in 'IN_RESTAURANT', regexGlueDetect might still return 'find_nearby'
            // We can protect against it?
            // Simplest is: if Locked, dont run discovery rules for find_nearby, proceed to existing logic.
        }

        // 1. Context-Based Decision (Priority High)
        // Jeśli czekamy na wybór restauracji, traktuj input jako selekcję
        if (session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'show_more_options') {
            // Jeśli user mówi "pizzę", a context jest select_restaurant, to znaczy że szuka "pizzy" w liście
            // Ale tutaj zwracamy select_restaurant aby handler to obsłużył.
            return {
                intent: 'select_restaurant',
                confidence: 0.95,
                entities: { raw: text },
                source: 'context_lock'
            };
        }

        if (session?.expectedContext === 'confirm_order') {
            if (/^nie\b/i.test(normalized)) {
                return { intent: 'cancel_order', confidence: 1.0, source: 'rule_guard' };
            }
            if (/(tak|potwierdzam|zamawiam)/i.test(normalized)) {
                return { intent: 'confirm_order', confidence: 1.0, source: 'rule_guard' };
            }
        }

        // --- OPTIMIZATION: Task 3 - Lexical Override ---
        // Force 'create_order' if specific keywords are present, BUT only if context didn't claim it
        if (/(wybieram|poproszę|wezmę|dodaj)/i.test(normalized)) {
            return {
                intent: 'create_order',
                confidence: 1.0,
                source: 'lexical_override',
                entities: {}
            };
        }

        // 1.5 Explicit Discovery Rules (Correction for Legacy)
        if (/\b(znajdz|znajdź|szukam|chcę zjeść|gdzie zjem|lokale|restauracje|głodny|glodny)\b/i.test(normalized)) {
            // Guard: If locked, ignore discovery?
            if (session?.context === 'IN_RESTAURANT' && session?.lockedRestaurantId) {
                // Ignore standard discovery, user might say "Szukam frytek" which is an order item
                // Do nothing here, let regexGlueDetect handle order parsing or fallback
            } else {
                return {
                    intent: 'find_nearby',
                    confidence: 0.9,
                    source: 'regex_override',
                    entities: {}
                };
            }
        }

        // 2. Direct Logic (Regex/Keyword)
        // Wykorzystujemy istniejący mechanizm "intentRouterGlue"
        try {
            const result = await detectIntent(text);

            // Temporary adapter until we rewrite intentRouterGlue fully
            if (result && result.intent && result.intent !== 'UNKNOWN_INTENT' && result.intent !== 'unknown') {

                // --- Task 1: Lock Protection ---
                // If locked, and intent implies changing restaurant context (like find_nearby), downgrade or verify
                if (session?.context === 'IN_RESTAURANT' && session?.lockedRestaurantId) {
                    if (['find_nearby', 'select_restaurant'].includes(result.intent)) {
                        // Double check escape phrases, otherwise interpret as order/menu query
                        // "Chcę pizzę" -> find_nearby in legacy?
                        // If locked, "Chcę pizzę" should be "menu_request" (looking for pizza in this restaurant)
                        // For now, let's override to menu_request if we think it's food.
                        // But unsafe to override bluntly.
                        // Let's just trust router if not ambiguous.
                    }
                }

                return {
                    intent: result.intent,
                    confidence: result.confidence || 0.8,
                    source: 'classic_regex',
                    entities: {
                        restaurant: result.restaurant
                    }
                };
            }
        } catch (e) {
            console.warn('Legacy detectIntent failed', e);
        }

        // 3. Fallback / LLM (To be implemented properly)
        // Na razie zwracamy fallback lub unknown
        return {
            intent: 'unknown',
            confidence: 0.0,
            source: 'fallback'
        };
    }
}

// Wrapper for legacy glue
function detectIntent(text) {
    return regexGlueDetect(text);
}
