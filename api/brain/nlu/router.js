/**
 * NLU Router - Decyzyjny Mózg
 * Odpowiada za klasyfikację intencji i ekstrakcję encji.
 * NIE dotyka bazy danych. Służy do tego warstwa domenowa.
 */

import { normalizeTxt } from '../intents/intentRouterGlue.js';
import { BrainLogger } from '../../../utils/logger.js';
import { smartResolveIntent } from '../ai/smartIntent.js';

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

        // A. Menu Request (Simple only)
        // Only match bare "menu" or "pokaż menu" to avoid overriding "menu w [Restaurant]" which legacy handles better
        if (/^(poka[zż]\s+)?(menu|karta|oferta|list[ae])(\s+da[ńn])?$/i.test(normalized)) {
            return {
                intent: 'menu_request',
                confidence: 0.95,
                source: 'regex_v2',
                entities: {}
            };
        }

        // B. Find Nearby / Discovery
        // "co polecisz w Piekarach", "szukam fast food", "chcę coś zjeść"
        const findRegex = /(co|gdzie).*(zje[sś][ćc]|poleca|poleci)|(szukam|znajd[źz]).*|(chc[ęe]|głodny|glodny).*(co[śs]|zje[sś][ćc])|(lokale|restauracje|knajpy|pizzeri[ae]|kebaby|bary)/i;

        BrainLogger.nlu(`FindRegex check on "${normalized}": ${findRegex.test(normalized)}`);

        if (findRegex.test(normalized)) {
            const entities = {};

            // Location extraction (naive "w [X]") - Use RAW TEXT for case sensitivity
            const locMatch = text.match(/\bw\s+([A-ZŁŚŻŹĆ][a-złęśżźćń]+)/);
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

        // 2. Smart Intent Layer (Hybrid: Regex Glue + LLM Fallback)
        try {
            const EXPERT_MODE = process.env.EXPERT_MODE === 'true';

            if (EXPERT_MODE) {
                const smartResult = await smartResolveIntent({
                    text,
                    session,
                    previousIntent: session?.lastIntent
                });

                if (smartResult && smartResult.intent && smartResult.intent !== 'unknown') {
                    return {
                        intent: smartResult.intent,
                        confidence: smartResult.confidence || 0.8,
                        source: smartResult.source || 'smart_hybrid',
                        entities: smartResult.slots || {}
                    };
                }
            } else {
                // ETAP 4: Strictly classic/rule-based. 
                // Since our rules above already covered most, we can do a final legacy check or just fallback.
                // We'll use the classic detectIntent for robustness.
                const { detectIntent } = await import('../intents/intentRouterGlue.js');
                const result = await detectIntent(text);
                if (result && result.intent && result.intent !== 'unknown') {
                    return {
                        intent: result.intent,
                        confidence: result.confidence || 0.8,
                        source: 'classic_legacy',
                        entities: { restaurant: result.restaurant }
                    };
                }
            }
        } catch (e) {
            console.warn('SmartIntent/Legacy failed', e);
        }

        // 3. Last Resort Fallback
        return {
            intent: 'unknown',
            confidence: 0.0,
            source: 'fallback',
            entities: {}
        };
    }
}
