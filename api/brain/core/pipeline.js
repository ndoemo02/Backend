/**
 * Core Pipeline Orchestrator (V2)
 * Odpowiada za przepływ danych: Request -> Hydration -> NLU -> Domain -> Response
 */

import { getSession, updateSession } from '../session/sessionStore.js';
import { FindRestaurantHandler } from '../domains/food/findHandler.js';
import { MenuHandler } from '../domains/food/menuHandler.js';
import { OrderHandler } from '../domains/food/orderHandler.js';
import { ConfirmOrderHandler } from '../domains/food/confirmHandler.js';
import { SelectRestaurantHandler } from '../domains/food/selectHandler.js';
import { OptionHandler } from '../domains/food/optionHandler.js';
import { ConfirmAddToCartHandler } from '../domains/food/confirmAddToCartHandler.js';
import { BrainLogger } from '../../../utils/logger.js';
import { playTTS, stylizeWithGPT4o } from '../tts/ttsClient.js';
import { EventLogger } from '../services/EventLogger.js';
import { getConfig } from '../../config/configService.js';

// Mapa handlerów domenowych (Bezpośrednie mapowanie)
// Kluczem jest "domain", a wewnątrz "intent"

// Default Handlers Map
const defaultHandlers = {
    food: {
        find_nearby: new FindRestaurantHandler(),
        menu_request: new MenuHandler(), // Correct NLU mapping
        show_menu: new MenuHandler(),    // Alias
        create_order: new OrderHandler(),
        choose_restaurant: new OrderHandler(), // Handle ambiguous restaurant choice in OrderHandler
        confirm_order: new ConfirmOrderHandler(),
        confirm_add_to_cart: new ConfirmAddToCartHandler(), // NEW
        select_restaurant: new SelectRestaurantHandler(),
        show_more_options: new OptionHandler(),
        find_nearby_confirmation: new FindRestaurantHandler(),
        recommend: {
            execute: async (ctx) => ({
                reply: 'Co polecam? W okolicy masz świetne opcje! Powiedz gdzie szukać.',
                intent: 'recommend',
                contextUpdates: { expectedContext: 'find_nearby' }
            })
        },
        cancel_order: {
            execute: async (ctx) => ({
                reply: 'Zamówienie anulowałam.',
                intent: 'cancel_order',
                contextUpdates: { pendingOrder: null, expectedContext: null }
            })
        },
        confirm: new FindRestaurantHandler(),
    },
    ordering: {
        create_order: new OrderHandler(),
        confirm_order: new ConfirmOrderHandler(),
    },
    system: {
        health_check: { execute: async () => ({ reply: 'System działa', meta: {} }) },
        fallback: { execute: async () => ({ reply: 'Nie rozumiem tego polecenia.', fallback: true }) }
    },
};

import { SupabaseRestaurantRepository } from './repository.js';

export class BrainPipeline {
    constructor(deps = {}) {
        this.nlu = deps.nlu;
        // Repository Injection: Use provided or default Supabase
        this.repository = deps.repository || new SupabaseRestaurantRepository();

        // Dynamic Handler Initialization with DI
        this.handlers = this.createHandlers(this.repository, deps.handlers);
    }

    createHandlers(repository, overrides = {}) {
        const defaults = {
            food: {
                find_nearby: new FindRestaurantHandler(repository),
                menu_request: new MenuHandler(), // Need repo injection too if MenuHandler refactored
                show_menu: new MenuHandler(),
                create_order: new OrderHandler(),
                choose_restaurant: new OrderHandler(),
                confirm_order: new ConfirmOrderHandler(),
                confirm_add_to_cart: new ConfirmAddToCartHandler(), // NEW
                select_restaurant: new SelectRestaurantHandler(),
                show_more_options: new OptionHandler(),
                find_nearby_confirmation: new FindRestaurantHandler(repository),
                recommend: {
                    execute: async (ctx) => ({
                        reply: 'Co polecam? W okolicy masz świetne opcje! Powiedz gdzie szukać.',
                        intent: 'recommend',
                        contextUpdates: { expectedContext: 'find_nearby' }
                    })
                },
                cancel_order: {
                    execute: async (ctx) => ({
                        reply: 'Zamówienie anulowałam.',
                        intent: 'cancel_order',
                        contextUpdates: { pendingOrder: null, expectedContext: null }
                    })
                },
                confirm: new FindRestaurantHandler(repository),
            },
            ordering: {
                create_order: new OrderHandler(),
                confirm_order: new ConfirmOrderHandler(),
            },
            system: {
                health_check: { execute: async () => ({ reply: 'System działa', meta: {} }) },
                fallback: { execute: async () => ({ reply: 'Nie rozumiem tego polecenia.', fallback: true }) }
            },
        };

        // Deep merge overrides if any (simplified)
        // For now, if overrides provided, we might just replace. 
        // But tests usually provide mocks via repo, not handler overrides.
        // If 'handlers' passed in deps, assume it's full map replacement (legacy support).
        if (overrides && Object.keys(overrides).length > 0) return overrides;

        return defaults;
    }

    /**
     * Główny punkt wejścia dla każdego zapytania
     */
    async process(sessionId, text, options = {}) {
        const startTime = Date.now();
        const IS_SHADOW = options.shadow === true;
        const config = await getConfig();

        // 1. Hydration & Validation
        if (!text || !text.trim()) {
            return this.createErrorResponse('brak_tekstu', 'Nie usłyszałam, możesz powtórzyć?');
        }

        const EXPERT_MODE = process.env.EXPERT_MODE !== 'false';

        // --- Event Logging: Received ---
        if (EXPERT_MODE && !IS_SHADOW) {
            const initialWorkflowStep = this._mapWorkflowStep('request_received');
            EventLogger.logConversation(sessionId).catch(() => { });
            EventLogger.logEvent(sessionId, 'request_received', { text }, null, initialWorkflowStep).catch(() => { });
        }

        const session = getSession(sessionId);
        // Deep copy session for shadow mode simulation
        const sessionContext = IS_SHADOW ? JSON.parse(JSON.stringify(session || {})) : session;

        const context = {
            sessionId,
            text,
            session: sessionContext,
            startTime,
            meta: {}
        };

        try {
            // 2. NLU Decision
            const intentResult = await this.nlu.detect(context);

            const { intent, domain, confidence, source, entities } = intentResult;

            context.intent = intent;
            context.domain = domain || 'food';
            context.entities = entities || {};
            context.confidence = confidence;
            context.source = source;

            // --- RESTAURANT PRIORITY RESOLUTION (Utterance > Session) ---
            const resolvedRestaurant =
                entities?.restaurant ||           // 1. Utterance (explicit mention)
                entities?.restaurantId ||         // 2. Catalog match ID
                session?.currentRestaurant ||     // 3. Session persistent
                session?.lastRestaurant;          // 4. Fallback

            context.resolvedRestaurant = resolvedRestaurant;

            // --- UX GUARDS (Dialog State Polish) ---

            // UX Guard 1: Menu-Scoped Ordering
            // If we have currentRestaurant and lastIntent was menu-related,
            // allow create_order scoped to that restaurant instead of discovery reset
            if (context.intent === 'find_nearby' && context.source === 'legacy_hard_blocked') {
                const hasRestaurantContext = session?.currentRestaurant || session?.lastRestaurant;
                const wasMenuFlow = session?.lastIntent === 'menu_request' ||
                    session?.expectedContext === 'restaurant_menu' ||
                    session?.expectedContext === 'continue_order';

                if (hasRestaurantContext && wasMenuFlow) {
                    BrainLogger.pipeline('✨ UX Guard 1: Menu-scoped ordering. Upgrading find_nearby -> create_order with currentRestaurant.');
                    context.intent = 'create_order';
                    context.source = 'menu_scoped_order';
                    context.resolvedRestaurant = session.currentRestaurant || session.lastRestaurant;
                }
            }

            // UX Guard 2: Fuzzy Restaurant Confirmation
            // If user mentions a restaurant name similar to currentRestaurant, ask for confirmation
            if (context.intent === 'find_nearby' && session?.currentRestaurant && entities?.restaurant) {
                const currentName = (session.currentRestaurant.name || '').toLowerCase();
                const mentionedName = (entities.restaurant || '').toLowerCase();

                // Simple fuzzy: first 4 chars match or partial include
                const isSimilar = currentName.substring(0, 4) === mentionedName.substring(0, 4) ||
                    currentName.includes(mentionedName.substring(0, 5)) ||
                    mentionedName.includes(currentName.substring(0, 5));

                if (isSimilar && currentName !== mentionedName) {
                    BrainLogger.pipeline(`✨ UX Guard 2: Fuzzy match detected. Asking confirmation for ${session.currentRestaurant.name}`);
                    return {
                        session_id: sessionId,
                        reply: `Czy chodziło Ci o ${session.currentRestaurant.name}?`,
                        should_reply: true,
                        intent: 'confirm_restaurant',
                        contextUpdates: {
                            expectedContext: 'confirm_restaurant',
                            pendingRestaurantConfirm: session.currentRestaurant
                        },
                        meta: { source: 'ux_guard_fuzzy_confirm' }
                    };
                }
            }

            // --- GUARDS ---

            // Rule: Confirm Guard
            if (session?.expectedContext === 'confirm_order') {
                const normalized = (text || "").toLowerCase();
                const confirmWords = /\b(tak|potwierdzam|ok|dobra|może być|dawaj|pewnie|jasne|super|świetnie)\b/i;
                if (confirmWords.test(normalized)) {
                    BrainLogger.pipeline('🛡️ Guard: Context is confirm_order and confirmation word detected. Forcing confirm_order.');
                    context.intent = 'confirm_order';
                }
            }

            // Rule 4: Auto Menu
            if (context.intent === 'select_restaurant') {
                const normalized = (text || "").toLowerCase();
                const wantsToSee = /\b(pokaz|pokaż|zobacz|jakie|co)\b/i.test(normalized);
                const wantsChange = /\b(inn[ea]|zmień|wybierz\s+inne)\b/i.test(normalized);

                if (wantsToSee && !wantsChange) {
                    BrainLogger.pipeline('🛡️ Guard Rule 4: "Show" verb detected. Upgrading select_restaurant -> menu_request');
                    context.intent = 'menu_request';
                }
            }

            // Rule 2: Early Dish Detection
            if (context.intent === 'create_order') {
                const ent = context.entities || {};
                const normalized = (text || "").toLowerCase();
                const strictOrderVerbs = /\b(zamawiam|wezm[ęe]|dodaj|poprosz[ęe]|chc[ęe])\b/i;
                const hasOrderVerb = strictOrderVerbs.test(normalized);

                if (!hasOrderVerb && !session?.pendingOrder && !session?.expectedContext) {
                    BrainLogger.pipeline('🛡️ Guard Rule 2: Implicit order without verb. Downgrading to find_nearby/menu_request.');
                    if (ent?.dish || ent?.items?.length) {
                        context.intent = 'menu_request';
                    } else {
                        return {
                            session_id: sessionId,
                            reply: "Co chciałbyś zamówić?",
                            should_reply: true,
                            intent: 'create_order',
                            meta: { source: 'guard_rule_2_explicit_prompt' }
                        };
                    }
                }

                // --- RULE 6: Empty Order / Adjective Guard ---
                if (context.intent === 'create_order') {
                    // Check if we have items or dish
                    // Re-read items directly from parser if needed, but entity should have it
                    // Simple check: if ent.items is empty and ent.dish is empty -> Problem
                    const hasItems = ent?.items && ent.items.length > 0;
                    const hasExplicitDish = ent?.dish || (hasItems && ent.items[0]?.name !== 'Unknown');

                    if (!hasExplicitDish && !hasItems && hasOrderVerb) {
                        // Opcja B: Exception for longer text (potential dish name not yet parsed)
                        const stripped = normalized.replace(strictOrderVerbs, '').trim();
                        if (stripped.length > 2) {
                            BrainLogger.pipeline(`🛡️ Guard Rule 6: Passing potential dish "${stripped}" to handlers despite missing entities.`);
                            // Do NOT return here. Let it pass to OrderHandler which will call parseOrderItems
                        } else {
                            BrainLogger.pipeline('🛡️ Guard Rule 6: Order intent with no explicit dish. Asking for details.');
                            return {
                                session_id: sessionId,
                                reply: "Co dokładnie chciałbyś zamówić?",
                                should_reply: true,
                                intent: 'create_order',
                                meta: { source: 'guard_rule_6_no_dish' }
                            };
                        }
                    }
                }
            }

            // Zombie Kill Switch
            if (session?.status === 'COMPLETED' && !IS_SHADOW) {
                if (!['new_order', 'start_over', 'help'].includes(context.intent)) {
                    return {
                        ok: true,
                        intent: 'session_locked',
                        reply: "Twoje zamówienie zostało już zakończone. Powiedz 'nowe zamówienie', aby zacząć od początku.",
                        meta: { source: 'guard_lock' }
                    };
                }
                // Reset session if intent is allowed
                updateSession(sessionId, { status: 'active', pendingOrder: null, lockedRestaurantId: null, context: 'neutral' });
            }

            // Update session (Short-term memory)
            if (!IS_SHADOW) {
                updateSession(sessionId, { lastIntent: context.intent, lastUpdated: Date.now() });
            }

            // 3. Domain Dispatching
            if (!this.handlers[context.domain]) {
                return this.createErrorResponse('unknown_domain', 'Nie wiem jak to obsłużyć (błąd domeny).');
            }

            const handler = this.handlers[context.domain][context.intent] || this.handlers.system.fallback;
            const domainResponse = await handler.execute(context);

            // Apply state changes from handler
            if (domainResponse.contextUpdates && !IS_SHADOW) {
                updateSession(sessionId, domainResponse.contextUpdates);
            }

            // --- SHADOW MODE EXIT ---
            if (IS_SHADOW) {
                return {
                    intent: context.intent,
                    domain: context.domain,
                    reply: domainResponse.reply,
                    meta: {
                        latency_ms: Date.now() - startTime,
                        source,
                        confidence
                    },
                    mockContextUpdates: domainResponse.contextUpdates,
                    rawResponse: domainResponse
                };
            }

            // 4.5 Synthesis (Expert Layer)
            let speechText = domainResponse.reply;
            let audioContent = null;
            let stylingMs = 0;
            let ttsMs = 0;

            if ((EXPERT_MODE || options.stylize) && domainResponse.reply) {
                const t0 = Date.now();
                speechText = await stylizeWithGPT4o(domainResponse.reply, intent);
                stylingMs = Date.now() - t0;
            }

            // Optimization for Voice Presentations:
            // If we have items to present, only TTS the intro part to avoid double reading on frontend
            let speechPartForTTS = speechText;
            const hasItemsToPresent = (domainResponse.restaurants?.length > 0) || (domainResponse.menuItems?.length > 0);

            if (hasItemsToPresent && speechText && speechText.includes('\n')) {
                const lines = speechText.split('\n');
                let intro = lines[0].trim();
                // If first line is too short (e.g. "Ok:"), take more
                if (intro.length < 10 && lines.length > 1) {
                    intro = lines.slice(0, 2).join(' ').trim();
                }
                speechPartForTTS = intro;
                BrainLogger.pipeline(`✂️ Truncating TTS for presentation: "${speechPartForTTS.substring(0, 30)}..."`);
            }

            // Respect options or default to false
            const wantsTTS = options.includeTTS === true;
            const hasReply = domainResponse.should_reply !== false; // Default true
            const ttsEnabled = config?.tts_enabled === true; // Strict check: defaults to false if undefined or null, only true if explicitly true

            if (hasReply && (wantsTTS || EXPERT_MODE) && ttsEnabled) {
                if (speechPartForTTS) {
                    try {
                        const t0 = Date.now();
                        audioContent = await playTTS(speechPartForTTS, options.ttsOptions || {});
                        ttsMs = Date.now() - t0;
                        BrainLogger.pipeline(`🔊 TTS Generated in ${ttsMs}ms (Length: ${speechPartForTTS.length})`);
                    } catch (err) {
                        BrainLogger.pipeline(`❌ TTS failed: ${err.message}`);
                    }
                }
            }

            const totalLatency = Date.now() - startTime;

            // 5. Response Synthesis (Legacy Parity)
            const { contextUpdates, meta: domainMeta, reply: _r, ...cleanDomainResponse } = domainResponse;

            const restaurants = cleanDomainResponse.restaurants || [];
            const menuItems = cleanDomainResponse.menuItems || [];

            const response = {
                ...cleanDomainResponse,
                ok: true,
                session_id: sessionId,
                text: speechText, // Legacy Text
                reply: speechText, // Legacy Reply
                tts_text: speechPartForTTS, // Explicitly return what was used for TTS
                audioContent: audioContent,
                intent: intent,
                should_reply: domainResponse.should_reply ?? true,
                actions: domainResponse.actions || [],
                restaurants: restaurants,
                menuItems: menuItems,
                menu: menuItems, // Legacy Alias
                meta: {
                    latency_total_ms: totalLatency,
                    source: domainMeta?.source || source || 'llm',
                    styling_ms: stylingMs,
                    tts_ms: ttsMs,
                    ...(domainMeta || {})
                },
                context: getSession(sessionId),
                locationRestaurants: restaurants, // Legacy Alias
                timestamp: new Date().toISOString()
            };

            // Legacy alias for discovery
            if (restaurants.length > 0) {
                response.locationRestaurants = restaurants;
            }

            if (EXPERT_MODE) {
                const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                response.turn_id = turnId;
                // Expert mode allows background analytics
                const wStep = this._mapWorkflowStep(intent);
                EventLogger.logEvent(sessionId, 'intent_resolved', {
                    intent, reply: speechText, confidence, source, domain: context.domain
                }, confidence, wStep).catch(() => { });

                this.persistAnalytics({
                    intent, reply: speechText, durationMs: totalLatency, confidence, ttsMs
                }).catch(() => { });
            }

            return response;

        } catch (error) {
            BrainLogger.pipeline('Error:', error.message);
            return this.createErrorResponse('internal_error', 'Coś poszło nie tak w moich obwodach.');
        }
    }

    _mapWorkflowStep(intentName) {
        if (intentName === 'confirm_order') return 'confirm_order';
        return intentName;
    }

    async persistAnalytics(p) {
        if (process.env.NODE_ENV === 'test') return;
        try {
            await supabase.from('amber_intents').insert({
                intent: p.intent,
                reply: typeof p.reply === 'string' ? p.reply.slice(0, 1000) : JSON.stringify(p.reply).slice(0, 1000),
                duration_ms: p.durationMs,
                confidence: p.confidence || 1.0,
                tts_ms: p.ttsMs || 0
            });
        } catch (e) {
            // Ignore missing table
        }
    }

    createErrorResponse(errorCode, message) {
        return {
            ok: false,
            error: errorCode,
            reply: message,
            timestamp: new Date().toISOString()
        };
    }
}
