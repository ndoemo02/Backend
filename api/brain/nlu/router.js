/**
 * NLU Router - Decyzyjny Mózg (V2)
 * Odpowiada za klasyfikację intencji i ekstrakcję encji.
 * Wykorzystuje Static Catalog dla wydajności.
 */

import { normalizeTxt } from '../intents/intentRouterGlue.js';
import { BrainLogger } from '../../../utils/logger.js';
import { smartResolveIntent } from '../ai/smartIntent.js';
import { parseRestaurantAndDish } from '../order/parseOrderItems.js';
import { extractLocation, extractCuisineType, extractQuantity } from './extractors.js';
import { findRestaurantInText } from '../data/restaurantCatalog.js';

export class NLURouter {
    constructor() {
        // Cache or loading models here
    }

    /**
     * Mapuje intent -> domain
     */
    _mapDomain(intent) {
        if (!intent) return 'unknown';
        if (['find_nearby', 'select_restaurant', 'menu_request', 'show_city_results', 'show_more_options', 'recommend', 'confirm', 'cancel_order'].includes(intent)) return 'food';
        if (['create_order', 'confirm_order', 'add_item', 'choose_restaurant'].includes(intent)) return 'ordering';
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

        // 1. Entity Extraction (NLU Layer)
        // Now using advanced extractors ported from Legacy
        const location = extractLocation(text); // Handles inflections like "Piekarach"
        const cuisine = extractCuisineType(text);
        const quantity = extractQuantity(text);

        // 2. Static Catalog Lookup (Fast Match)
        // Instant 0ms check against known 9 restaurants
        const matchedRestaurant = findRestaurantInText(text);

        const entities = {
            location,
            cuisine,
            quantity,
            restaurant: matchedRestaurant ? matchedRestaurant.name : null,
            restaurantId: matchedRestaurant ? matchedRestaurant.id : null
        };

        // --- RULE 0 & 5: Discovery & Numerals (Blocking Rules) ---

        // 0. Explicit Discovery Keywords (includes location-relative phrases)
        // NOTE: Include both Polish and ASCII versions since normalizeTxt strips diacritics
        const DISCOVERY_KEYWORDS = ['miejsca', 'restauracje', 'lokale', 'pizzerie', 'gdzie', 'szukam', 'znajdz', 'znajdź',
            'kolo mnie', 'koło mnie', 'w poblizu', 'w pobliżu', 'blisko', 'niedaleko', 'w okolicy'];
        // 0.25 Uncertainty markers (e.g., "kfc chyba" = user is exploring, not ordering)
        const UNCERTAINTY_KEYWORDS = ['chyba', 'może', 'jakiś', 'jakieś', 'coś'];
        // 0.5 Explicit Recommend Keywords
        const RECOMMEND_KEYWORDS = ['polecisz', 'polec'];
        // 5. Numeric Discovery (e.g. "dwa kebaby", "trzy lokale") - if no ordering verb, it's discovery
        const NUMERALS = /\b(dwa|dwie|dwoje|trzy|troje|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|kilka|parę)\b/i;
        const ORDER_VERBS = /\b(menu|karta|oferta|zamawiam|wezm[ęe]|dodaj|poprosz[ęe]|chc[ęe]|bior[ęe])\b/i;

        const isRecommend = RECOMMEND_KEYWORDS.some(k => normalized.includes(k));
        const isDiscovery = DISCOVERY_KEYWORDS.some(k => normalized.includes(k));
        const isUncertain = UNCERTAINTY_KEYWORDS.some(k => normalized.includes(k));
        const isNumericDiscovery = NUMERALS.test(normalized) && !ORDER_VERBS.test(normalized);

        if (isRecommend) {
            // If recommend + location → treat as find_nearby (implicit discovery)
            if (location) {
                return {
                    intent: 'find_nearby',
                    confidence: 0.99,
                    source: 'recommend_with_location',
                    entities
                };
            }
            // No location → ask where to search
            return {
                intent: 'recommend',
                confidence: 0.99,
                source: 'recommend_keyword',
                entities
            };
        }

        if (isDiscovery || isNumericDiscovery || isUncertain) {
            return {
                intent: 'find_nearby',
                confidence: 0.99,
                source: isNumericDiscovery ? 'rule_5_numeric' : (isUncertain ? 'uncertainty_block' : 'discovery_guard_block'),
                entities
            };
        }

        // --- RULE 3: Strict Restaurant Match (Catalog) ---
        // If we found a restaurant from our static list 
        if (matchedRestaurant) {
            // Check context: "pokaż menu w Hubertusie" vs "idziemy do Hubertusa"
            if (/\b(menu|karta|oferta|cennik|co\s+ma|co\s+maja|zje[sś][ćc])\b/i.test(normalized)) {
                return {
                    intent: 'menu_request', // Or show_menu alias
                    confidence: 1.0,
                    source: 'catalog_match_menu',
                    entities
                };
            }
            // Default to selecting that restaurant
            return {
                intent: 'select_restaurant',
                confidence: 0.98,
                source: 'catalog_match_explicit',
                entities
            };
        }

        // --- RULE 3b: Aliases & Entity Parsing (Dish Detection) ---
        const parsed = parseRestaurantAndDish(text);

        // --- RULE 1: Show + Restaurant (UX Guard) ---
        if (parsed.restaurant && /\b(pokaz|pokaż|co|jakie|zobacz)\b/i.test(normalized)) {
            if (!isDiscovery) {
                return {
                    intent: 'menu_request',
                    confidence: 1.0,
                    source: 'guard_rule_1',
                    entities: { ...entities, restaurant: parsed.restaurant, dish: parsed.dish }
                };
            }
        }

        // --- OPTIMIZATION: Task 1 - Restaurant Lock ---
        if (session?.context === 'IN_RESTAURANT' && session?.lockedRestaurantId) {
            if (/(zmień|wróć|inn[ea]|powrót)/i.test(normalized)) {
                return { intent: 'find_nearby', confidence: 0.9, source: 'lock_escape', entities: {} };
            }
        }

        // 0.5. Explicit "More Options" Detection (Prioritize over selection)
        if (/\b(wiecej|więcej|inne|opcje|lista)\b/i.test(normalized)) {
            // Only if we were just looking for restaurants
            if (session?.lastIntent === 'find_nearby' || session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'show_more_options') {
                return {
                    intent: 'show_more_options',
                    confidence: 0.99,
                    source: 'explicit_more_options',
                    entities
                };
            }
        }

        // 1. Context-Based Decision (Priority High)
        if (session?.expectedContext === 'select_restaurant' || session?.expectedContext === 'show_more_options') {
            // Only if it doesn't look like a new intent
            const isIntentLike = /(menu|zamawiam|pokaż|znajdź|gdzie|health)/i.test(normalized);
            // If it's just a number or simple phrase, it's selection
            if (!isIntentLike || /^[0-9]$/.test(normalized.trim())) {
                return {
                    intent: 'select_restaurant',
                    confidence: 0.95,
                    entities: { ...entities, raw: text },
                    source: 'context_lock'
                };
            }
        }

        if (session?.expectedContext === 'confirm_order') {
            if (/^(nie|nie\s+chcę|anuluj|stop)$/i.test(normalized)) {
                return { intent: 'cancel_order', confidence: 1.0, source: 'rule_guard', entities };
            }
            if (/^(tak|potwierdzam|potwierdza|ok|dobra|zamawiam|dodaj|proszę)$/i.test(normalized)) {
                return { intent: 'confirm_order', confidence: 1.0, source: 'rule_guard', entities };
            }
        }

        // --- RULE 7: Generic Confirm (Legacy Parity) ---
        if (/^tak$/i.test(normalized)) {
            return { intent: 'confirm', confidence: 0.9, source: 'generic_confirm', entities };
        }

        // --- OPTIMIZATION: Task 3 - Lexical Override ---
        // Exception: if user mentions "menu/karta/oferta" they want to see menu first
        const isOrderingVerb = /(wybieram|poprosze|poprosz[ęe]|wezme|wezm[ęe]|dodaj|zamawiam|zamow|zamów|chce|chc[ęe]|zamowie|zamówię)/i.test(normalized);
        const wantsMenuFirst = /\b(menu|karta|karte|kartę|oferta|ofertę|oferte|cennik|co\s+macie|lista|pokaz|pokaż|zobacz)\b/i.test(normalized);

        // "Chcę" guard: skip if followed by discovery terms
        const isChceDiscovery = /chc[ęe]\s+(co|gdzie|zje|jedzenie|kuchni|kuchnia|dania|danie|azjatyckie|wloskie|włoskie|chinskie|chińskie|orientalne|restauracj)/i.test(normalized);

        if (!wantsMenuFirst && isOrderingVerb && !isChceDiscovery) {
            return {
                intent: 'create_order',
                confidence: 1.0,
                source: 'lexical_override',
                entities
            };
        }

        // 1.5 Explicit Regex NLU (Standardized)

        // A. Menu Request (Simple only OR complex with "pokaż menu")
        // Relaxed: if "pokaż/zobacz" + "menu/karta/oferta" anywhere in text OR "co macie"
        if (/^(poka[zż]\s+)?(menu|karta|karte|kartę|oferta|oferte|ofertę|list[ae])(\s+da[ńn])?$/i.test(normalized) ||
            /\b(poka[zż]|zobacz|sprawdz|sprawdź|co)\b.*\b(menu|karta|karte|kartę|oferta|oferte|ofertę|list[ae]|cennik|macie|oferte|ofertę)\b/i.test(normalized)) {
            return {
                intent: 'menu_request',
                confidence: 0.95,
                source: 'regex_v2',
                entities
            };
        }

        // B. Find Nearby / Discovery (Fallback Regex)
        // NOTE: Also triggers for standalone food words when no order context (exploration mode)
        // B. Find Nearby / Discovery (Fallback Regex)
        // NOTE: Also triggers for standalone food words when no order context (exploration mode)
        const findRegex = /(co|gdzie).*(zje[sś][ćc]|poleca|poleci|masz|macie|jedzenia|jedzenie)|(szukam|znajd[źz]).*|(chc[ęe]|głodny|glodny|ochote|ochotę|co[śs]).*(co[śs]|zje[sś][ćc]|jedzenie|kuchni)|(lokale|restauracje|knajpy|pizzeri[ae]|kebaby|kebab|bary|pizza|burger|jedzenie|głodny|glodny)/i;

        // Guard: don't trigger findRegex if we have strong ordering verbs like "poproszę" or "zamawiam"
        const hasOrderVerbStrict = /\b(poprosze|poprosz[ęe]|zamawiam|zamow|wezme|wezm[ęe]|biore|bior[ęe]|dodaj)\b/i.test(normalized);

        if (findRegex.test(normalized) && !hasOrderVerbStrict) {
            return {
                intent: 'find_nearby',
                confidence: 0.95,
                source: 'regex_v2',
                entities
            };
        }

        // 2. Smart Intent Layer (Hybrid: LLM Fallback)
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
                        entities: { ...entities, ...smartResult.slots }
                    };
                }
            } else {
                const { detectIntent } = await import('../intents/intentRouterGlue.js');
                const result = await detectIntent(text, session, entities);
                // Skip if legacy returns unknown OR a weak clarify_order/choose_restaurant without any actual items
                const isWeakIntent = (result.intent === 'clarify_order' || result.intent === 'choose_restaurant') && (!result.items?.any && !result.items?.unavailable?.length && !result.options?.length);

                if (result && result.intent && result.intent !== 'unknown' && result.intent !== 'UNKNOWN_INTENT' && !isWeakIntent) {
                    return {
                        intent: result.intent,
                        confidence: result.confidence || 0.8,
                        source: 'classic_legacy',
                        entities: { ...entities, ...result.entities, restaurant: result.restaurant, items: result.parsedOrder || result.items }
                    };
                }
            }
        } catch (e) {
            console.warn('SmartIntent/Legacy failed', e);
        }

        // 3. Food-word Fallback: if unknown but contains food words, assume exploration
        const FOOD_WORDS = /\b(pizza|pizz[aeęyę]|kebab|kebaba|burger|burgera|burgery|sushi|ramen|pad\s*thai|pho|pierogi|pierog|zupy?|zup[ęka]|schabowy?|kotlet|frytki|frytek|king|kfc|mcdonald|mac|jedzenie|cos|coś|zjeść|zjesz|dania|baner|dobry)\b/i;
        if (FOOD_WORDS.test(normalized)) {
            return {
                intent: 'find_nearby',
                confidence: 0.6,
                source: 'food_word_fallback',
                entities
            };
        }

        // 4. Last Resort Fallback
        return {
            intent: 'unknown',
            confidence: 0.0,
            source: 'fallback',
            entities
        };
    }
}
