/**
 * NLU Router - Decyzyjny Mózg
 * Odpowiada za klasyfikację intencji i ekstrakcję encji.
 * NIE dotyka bazy danych. Służy do tego warstwa domenowa.
 */

import { detectIntent as regexGlueDetect } from '../intents/intentRouterGlue.js'; // Reuse existing logic for now
import { normalizeTxt } from '../intents/intentRouterGlue.js';
import { BrainLogger } from '../../../utils/logger.js';

export class NLURouter {
    constructor() {
        // Cache or loading models here
    }

    /**
     * Mapuje intent -> domain
     */
    _mapDomain(intent) {
        if (!intent) return 'unknown';
        if (['find_nearby', 'select_restaurant', 'menu_request', 'show_city_results'].includes(intent)) return 'food';
        if (['create_order', 'confirm_order', 'cancel_order', 'add_item'].includes(intent)) return 'ordering';
        return 'system';
    }

    /**
     * Wykrywa intencję z tekstu i kontekstu
     * @param {Object} ctx - Pipeline context (text, session, etc.)
     * @returns {Promise<{intent: string, confidence: number, entities: Object, source: string, domain: string}>}
     */
    async detect(ctx) {
        const result = await this._detectInternal(ctx);
        // Enrich with domain
        result.domain = this._mapDomain(result.intent);

        BrainLogger.nlu('Result:', result);
        return result;
    }

    async _detectInternal(ctx) {
        const { text, session } = ctx;
        const normalized = normalizeTxt(text);

        BrainLogger.nlu('Detecting intent for:', text);

        // --- RULE: New Order / Reset ---
        if (/(nowe\s+zam[óo]wienie|od\s+nowa|start|resetuj|zacznij)/i.test(normalized)) {
            return {
                intent: 'new_order',
                confidence: 1.0,
                source: 'rule_guard',
                entities: {}
            };
        }

        // --- OPTIMIZATION: Task 1 - Restaurant Lock ---
        if (session?.context === 'IN_RESTAURANT' && session?.lockedRestaurantId) {
            // Escape phrases
            if (/(zmień|wróć|inn[ea]|powrót)/i.test(normalized)) {
                return { intent: 'find_nearby', confidence: 0.9, source: 'lock_escape', entities: {} };
            }
        }

        // 1. Context-Based Decision (Priority High)
        if (session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'show_more_options') {
            return {
                intent: 'select_restaurant',
                confidence: 0.95,
                entities: { raw: text },
                source: 'context_lock'
            };
        }

        if (session?.expectedContext === 'confirm_order') {
            if (/^nie\b/i.test(normalized)) {
                return { intent: 'cancel_order', confidence: 1.0, source: 'rule_guard', entities: {} };
            }
            if (/(tak|potwierdzam|zamawiam)/i.test(normalized)) {
                return { intent: 'confirm_order', confidence: 1.0, source: 'rule_guard', entities: {} };
            }
        }

        // --- OPTIMIZATION: Task 3 - Lexical Override ---
        if (/(wybieram|poproszę|wezmę|dodaj|zamawiam|chc[ęe]\s+(?!co[śs]|zje[sś][ćc]|gdzie))/i.test(normalized)) {
            return {
                intent: 'create_order',
                confidence: 1.0,
                source: 'lexical_override',
                entities: {}
            };
        }

        // 1.5 Explicit Regex NLU (Standardized)

        // A. Menu Request
        if (/(poka[zż]|masz|macie|da[ij]|zobacz[ęe]).*(menu|kart[ęea]|ofert[ęe]|list[ęe])/i.test(normalized) ||
            /^menu\b/i.test(normalized)) {
            return {
                intent: 'menu_request',
                confidence: 0.95,
                source: 'regex_v2',
                entities: {}
            };
        }

        // B. Find Nearby / Discovery
        // "co polecisz w Piekarach", "szukam fast food", "chcę coś zjeść"
        const findRegex = /(co|gdzie).*(zje[sś][ćc]|poleca|poleci)|(szukam|znajd[źz]).*|(chc[ęe]|głodny|glodny).*(co[śs]|zje[sś][ćc])|(lokale|restauracje|knajpy)/i;
        if (findRegex.test(normalized)) {
            const entities = {};

            // Location extraction (naive "w [X]")
            const locMatch = normalized.match(/\bw\s+([A-ZŁŚŻŹĆ][a-złęśżźćń]+)/);
            if (locMatch) {
                entities.location = locMatch[1];
            }

            // Cuisine extraction (naive "szukam [X]")
            const searchMatch = normalized.match(/szukam\s+(.+)/i);
            if (searchMatch) {
                // exclude "restauracji" etc.
                const raw = searchMatch[1].trim();
                if (!['restauracji', 'lokalu', 'czegoś'].includes(raw)) {
                    entities.cuisine = raw;
                }
            }

            return {
                intent: 'find_nearby',
                confidence: 0.95,
                source: 'regex_v2',
                entities
            };
        }


        // 2. Direct Logic (Regex/Keyword)
        try {
            // Helper wrapper not needed here, call imported directly
            const result = await regexGlueDetect(text);

            if (result && result.intent && result.intent !== 'UNKNOWN_INTENT' && result.intent !== 'unknown') {

                // GUARD: Ambiguity check for testy king etc.
                const hasCtx = /\b(w|z|u|do|od|restauracja|knajpa|pizzeria|lokal)\b/i.test(text);
                if (result.intent === 'select_restaurant' && !hasCtx && (result.confidence || 0) < 0.98) {
                    return {
                        intent: 'find_nearby',
                        confidence: 0.85,
                        source: 'ambiguity_fallback',
                        entities: { query: text }
                    };
                }

                // RECOVERY: clarify_order -> find_nearby if food keywords present
                const foodKeywords = /\b(pizz[ai]|burger|kebab|sushi|kfc|mcdonald|jedzeni[ea]|obiad|lunch|kolacj[ai]|zje[sś][ćc])\b/i;
                if (result.intent === 'clarify_order' && foodKeywords.test(text)) {
                    return {
                        intent: 'find_nearby',
                        confidence: 0.85,
                        source: 'term_recovery_inner',
                        entities: { query: text }
                    };
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

        // 3. Fallback / Recovery for Food keywords (if legacy returned unknown/fail)
        const foodKeywordsOuter = /\b(pizz[ai]|burger|kebab|sushi|kfc|mcdonald|jedzeni[ea]|obiad|lunch|kolacj[ai]|zje[sś][ćc])\b/i;
        if (foodKeywordsOuter.test(normalized)) {
            return {
                intent: 'find_nearby',
                confidence: 0.8,
                source: 'term_recovery_outer',
                entities: { query: text }
            };
        }

        // 4. Default Fallback
        return {
            intent: 'unknown',
            confidence: 0.0,
            source: 'fallback',
            entities: {}
        };
    }
}
